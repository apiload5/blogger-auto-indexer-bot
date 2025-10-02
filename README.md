# Blogger Auto Indexer 🤖

A powerful Node.js application that automatically detects new posts on your Blogger blog and submits them to Google Indexing API for instant indexing in search results. No manual work required!

![GitHub](https://img.shields.io/badge/Node.js-18+-green)
![GitHub](https://img.shields.io/badge/Automated-Indexing-blue)
![GitHub](https://img.shields.io/badge/Free-Open_Source-success)

## 🌟 What This Tool Does

- **Automatically detects** new posts on your Blogger blog
- **Submits URLs** to Google Indexing API instantly
- **Runs every 3 hours** automatically via GitHub Actions
- **No server required** - completely free on GitHub
- **No Blogger API needed** - works with just your blog URL

## 🚀 Quick Start

### Prerequisites

1. **A Blogger blog** (any .blogspot.com or custom domain)
2. **Google Cloud Account** (free tier)
3. **GitHub Account** (free)

### Step 1: Setup Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable **Indexing API**:
   - Navigation Menu → APIs & Services → Library
   - Search "Indexing API" → Enable
4. Create Service Account:
   - IAM & Admin → Service Accounts → Create Service Account
   - Name: `blogger-indexing-bot`
   - Role: **Owner** (for testing)
   - Create Key → JSON → Download the file

### Step 2: Fork This Repository

Click the **Fork** button on top-right of this repository to create your own copy.

### Step 3: Configure GitHub Secrets

Go to your forked repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | From downloaded JSON file (client_email) |
| `GOOGLE_PRIVATE_KEY` | From JSON file (private_key) - copy entire key including `-----BEGIN PRIVATE KEY-----` |
| `BLOG_URL` | Your blog URL (e.g., `https://yourblog.blogspot.com`) |
| `RSS_FEED_URL` | Optional: Custom RSS feed URL |

### Step 4: How to Get Private Key

Open the downloaded JSON file and find the `private_key` field. Copy the entire value including:

**Important**: Keep the `\n` characters as they are - GitHub Secrets will handle them properly.

## 📁 Repository Structure

## 🔧 Manual Setup (Alternative)

If you want to run locally:

1. **Clone repository**:
   ```bash
   git clone https://github.com/apiload5/blogger-auto-indexer-bot.git
   it 
     cd blogger-auto-indexer-bot
   
 Install dependencies:npm install
 Create .env file:GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
 GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY\n-----END PRIVATE KEY-----\n"
 BLOG_URL=https://yourblog.blogspot.com
 RSS_FEED_URL=  # Optional
 Run manually:node index.js
⚙️ How It Works
Detection Methods (in order):
RSS Feed (Primary): Uses Blogger's built-in RSS feed

Default: https://yourblog.blogspot.com/feeds/posts/default

HTML Scraping (Fallback): Extracts post URLs from blog HTML

Indexing Process:
Check for new posts every 3 hours

Extract post URLs from RSS/HTML

Submit to Google Indexing API

Track indexed URLs to avoid duplicates

Rate limiting - 1 second between requests

📊 Monitoring
The application provides detailed logs:🚀 Starting Google Indexing Check...
📝 Checking for new posts via RSS...
✅ Found 5 posts via RSS
🔍 Indexing URL: https://yourblog.blogspot.com/2024/01/post-title.html
✅ Successfully indexed: https://yourblog.blogspot.com/2024/01/post-title.html

📊 Indexing Summary:
✅ Newly Indexed: 3
⏭️ Already Indexed: 2
❌ Failed: 0
📝 Total Checked: 5

🛠️ Customization
Change Check Interval
Edit
Edit .github/workflows/scheduled-indexing.yml:schedule:
  - cron: '0 */6 * * *'  # Every 6 hours
  # - cron: '0 * * * *'   # Every hour
  # - cron: '0 9 * * *'   # Daily at 9 AM
  Available Cron Patterns
0 */3 * * * - Every 3 hours

0 * * * * - Every hour

0 9,21 * * * - 9 AM and 9 PM daily

@daily - Once per day


❓ Frequently Asked Questions
Q: Is this free?
A: Yes! GitHub Actions provides 2000 free minutes per month.

Q: Do I need a server?
A: No, it runs completely on GitHub's infrastructure.

Q: Will this get my blog penalized by Google?
A: No, Google Indexing API is official and intended for this purpose.

Q: How fast does indexing work?
A: Typically within few hours instead of days/weeks.

Q: Can I use this with custom domain Blogger?
A: Yes, works with any Blogger blog.

Q: What if I have multiple blogs?
A: You can duplicate the workflow for each blog.

🐛 Troubleshooting
Common Issues:
Authentication Failed

Check Service Account email format

Verify private key includes \n characters

Ensure Indexing API is enabled

No Posts Found

Verify BLOG_URL is correct

Check if blog has public posts

Try providing RSS_FEED_URL directly

Rate Limit Errors

Application automatically handles rate limiting

Wait 1 hour and retry

📈 Benefits
✅ Faster Indexing: New posts indexed in hours instead of weeks

✅ Better SEO: Improved search visibility

✅ Completely Free: No hosting costs

✅ Automatic: Set once, forget forever

✅ Reliable: Runs on GitHub's infrastructure

🤝 Contributing
Feel free to:

Report bugs

Suggest features

Submit pull requests

Improve documentation

📄 License
This project is licensed under the MIT License - see the LICENSE file for details.

⚠️ Disclaimer
This tool uses Google's official Indexing API. Please respect Google's terms of service and rate limits. The developers are not responsible for any misuse.


   
   
