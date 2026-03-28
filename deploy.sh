#!/bin/bash
# One DSD Platform - One-Click Deploy to GitHub + Railway
# Run this in your terminal: bash deploy.sh

set -e
echo ""
echo "═══════════════════════════════════════════"
echo "  One DSD Platform — GitHub Deploy Script  "
echo "═══════════════════════════════════════════"
echo ""

# Step 1: GitHub auth via device flow
echo "Step 1: Getting GitHub authorization..."
RESPONSE=$(curl -s -X POST https://github.com/login/device/code \
  -H "Accept: application/json" \
  -d "client_id=178c6fc778ccc68e1d6a&scope=repo")

DEVICE_CODE=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['device_code'])")
USER_CODE=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['user_code'])")

echo ""
echo "┌─────────────────────────────────────┐"
echo "│  Open: https://github.com/login/device"
echo "│  Enter code: $USER_CODE"
echo "└─────────────────────────────────────┘"
echo ""
echo "Waiting for you to authorize..."

# Poll until authorized
while true; do
  sleep 10
  POLL=$(curl -s -X POST https://github.com/login/oauth/access_token \
    -H "Accept: application/json" \
    -d "client_id=178c6fc778ccc68e1d6a&device_code=$DEVICE_CODE&grant_type=urn:ietf:params:oauth:grant-type:device_code")
  
  TOKEN=$(echo "$POLL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null)
  ERROR=$(echo "$POLL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null)
  
  if [ -n "$TOKEN" ] && [ "$TOKEN" != "None" ]; then
    echo "✅ GitHub authorized!"
    export GH_TOKEN="$TOKEN"
    break
  elif [ "$ERROR" = "expired_token" ]; then
    echo "❌ Code expired. Run script again."
    exit 1
  fi
done

# Step 2: Create GitHub repo
echo ""
echo "Step 2: Creating GitHub repo..."
REPO_RESP=$(curl -s -X POST https://api.github.com/user/repos \
  -H "Authorization: token $GH_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  -d '{"name":"one-dsd-platform","description":"One DSD Equity Program Platform - MN DHS","private":false,"auto_init":false}')

REPO_URL=$(echo "$REPO_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('clone_url','ERROR: '+str(d.get('message','unknown'))))")
echo "Repo: $REPO_URL"

# Step 3: Push code
echo ""
echo "Step 3: Pushing code to GitHub..."
cd "$(dirname "$0")"
git remote remove origin 2>/dev/null || true
PUSH_URL=$(echo "$REPO_URL" | sed "s|https://|https://$GH_TOKEN@|")
git remote add origin "$PUSH_URL"
git branch -M main
git push -u origin main --force
echo "✅ Code pushed!"

# Step 4: Deploy instructions
OWNER=$(curl -s -H "Authorization: token $GH_TOKEN" https://api.github.com/user | python3 -c "import sys,json; print(json.load(sys.stdin)['login'])")
echo ""
echo "═══════════════════════════════════════════"
echo "✅ CODE IS ON GITHUB!"
echo ""
echo "Repo: https://github.com/$OWNER/one-dsd-platform"
echo ""
echo "FINAL STEP — Deploy to Railway (30 seconds):"
echo "1. Go to: https://railway.app/new"
echo "2. Click: Deploy from GitHub"
echo "3. Select: $OWNER/one-dsd-platform"
echo "4. Add env var: ANTHROPIC_API_KEY = your-key"
echo "5. Get your public URL!"
echo "═══════════════════════════════════════════"
