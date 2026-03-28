# Deploy One DSD Platform — 3 Steps

## Option A: Railway (drag & drop, no CLI needed)
1. Go to https://railway.app/new
2. Click "Deploy from ZIP" 
3. Drag `one-dsd-platform-v1.zip` into the window
4. When prompted, add environment variable:
   - Name: `ANTHROPIC_API_KEY`  
   - Value: your Claude API key
5. Click Deploy → get public URL in ~90 seconds

## Option B: Push to GitHub then Railway
```bash
# In Terminal on your Surface Pro:
cd path/to/one-dsd-github

git remote add origin https://github.com/Gary-design63/one-dsd-platform-v3.git
git push -u origin master

# Then on railway.app: New Project → GitHub → select repo → add ANTHROPIC_API_KEY
```

## Option C: Run locally right now
```bash
cd one-dsd-github
npm install
ANTHROPIC_API_KEY=your-key node server.js
# Open http://localhost:5000
```

## Your live URL (existing platform)
https://web-production-d4dc3.up.railway.app
