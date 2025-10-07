🔧 Replit Configuration (.replit)
# Replit configuration
run = "npm start"
language = "nodejs"
nodeVersion = "18"

[nix]
channel = "stable-22_11"

[env]
NODE_ENV = "production"
ENABLE_SCHEDULER = "true"
RUN_IMMEDIATELY = "true"
MAX_URLS_PER_RUN = "25"

[git]
enableGitHubImport = true

📋 Environment Variables Guide
GitHub Actions Secrets:
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-email@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...
BLOG_URL=https://yourblog.blogspot.com
RSS_FEED_URL=https://yourblog.blogspot.com/feeds/posts/default?alt=rss

Replit Environment Variables:

