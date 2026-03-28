module.exports = {
  apps: [{
    name: 'one-dsd',
    script: 'server.js',
    env: {
      PORT: process.env.PORT || 5000,
      NODE_ENV: 'production'
    }
  }]
}
