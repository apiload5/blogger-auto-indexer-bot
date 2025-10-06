const { google } = require('googleapis');
const axios = require('axios');
const cron = require('node-cron');
const Parser = require('rss-parser');
const { URL } = require('url'); 

// 🔑 SSL Fix
require('https').globalAgent.options.ciphers = 'DEFAULT@SECLEVEL=1'; 

// Environment variables - NAYA VARIABLE ADD KAREIN
const {
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY,
    BLOG_URL, 
    RSS_FEED_URL,
    SEARCH_CONSOLE_PROPERTY, // NAYA: sc-domain:ticnocity.blogspot.com
} = process.env;

// CONSTANTS
const MAX_URLS_TO_SUBMIT = 25;
const DELAY_BETWEEN_REQUESTS = 2000;

// RSS Parser initialize
const parser = new Parser();
const indexing = google.indexing('v3');
const searchconsole = google.searchconsole('v1'); // NAYA

const indexingAuth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/indexing', 'https://www.googleapis.com/auth/webmasters.readonly'],
    null
);

// =================================================================
// ## NAYA FUNCTION: Search Console se indexed URLs check karega
// =================================================================

async function getIndexedUrls() {
    try {
        console.log('🔍 Checking already indexed URLs from Search Console...');
        
        const response = await searchconsole.sitemaps.list({
            auth: indexingAuth,
            siteUrl: SEARCH_CONSOPER_CONSOLE_PROPERTY
        });
        
        // Ya alternative method
        const indexedResponse = await searchconsole.urlInspection.index.get({
            auth: indexingAuth,
            siteUrl: SEARCH_CONSOLE_PROPERTY,
            inspectionUrl: BLOG_URL
        });
        
        const indexedUrls = new Set();
        // Yahan aap appropriate response parsing karein based on Search Console API
        
        console.log(`✅ Found ${indexedUrls.size} already indexed URLs`);
        return indexedUrls;
    } catch (error) {
        console.error('❌ Search Console check error:', error.message);
        return new Set(); // Error case mein empty set return karega
    }
}

// =================================================================
// ## Post Fetching Logic (Modified)
// =================================================================

async function getLatestPosts() {
    try {
        console.log('📝 Checking for new posts...');
        
        // Pehle indexed URLs check karein
        const alreadyIndexedUrls = await getIndexedUrls();
        
        let rssUrl = RSS_FEED_URL || `${BLOG_URL.replace(/\/$/, '')}/feeds/posts/default?alt=rss`;
        console.log(`📡 Using RSS feed: ${rssUrl}`);
        
        const feed = await parser.parseURL(rssUrl);
        let posts = feed.items || [];
        
        // Sirf unhi posts ko filter karein jo indexed nahi hain
        const newPosts = posts.filter(post => {
            const postUrl = post.url || post.link;
            return !alreadyIndexedUrls.has(postUrl);
        });
        
        console.log(`📊 Total posts: ${posts.length}, New/Unindexed posts: ${newPosts.length}`);
        
        if (newPosts.length === 0) {
            console.log('ℹ️ All posts are already indexed. Falling back to HTML scraping...');
            const htmlPosts = await getPostsFromHTML();
            // HTML posts bhi filter karein
            return htmlPosts.filter(post => !alreadyIndexedUrls.has(post.url));
        }
        
        return newPosts;
    } catch (error) {
        console.error('❌ RSS Error:', error.message);
        console.log('🔄 Falling back to HTML scraping...');
        return await getPostsFromHTML();
    }
}

// =================================================================
// ## Priority-based Indexing Logic - NAYA
// =================================================================

function prioritizeUrls(posts) {
    console.log('🎯 Prioritizing URLs for indexing...');
    
    return posts
        .map(post => {
            let priority = 0;
            const url = post.url || post.link;
            const title = post.title || '';
            const pubDate = post.pubDate || post.isoDate || '';
            
            // Priority criteria:
            // 1. Naye posts (1-2 din ke andar) - High priority
            if (pubDate) {
                const postDate = new Date(pubDate);
                const daysOld = (new Date() - postDate) / (1000 * 60 * 60 * 24);
                if (daysOld <= 2) priority += 30;
                else if (daysOld <= 7) priority += 20;
                else priority += 10;
            }
            
            // 2. Important keywords in title - Medium priority
            const importantKeywords = ['latest', 'new', '2024', 'update', 'important', 'guide', 'tutorial'];
            if (title) {
                const lowerTitle = title.toLowerCase();
                importantKeywords.forEach(keyword => {
                    if (lowerTitle.includes(keyword)) priority += 5;
                });
            }
            
            // 3. Homepage ya important pages - Low priority
            if (url === BLOG_URL || url.includes('/p/')) {
                priority += 3;
            }
            
            return { ...post, priority, url };
        })
        .sort((a, b) => b.priority - a.priority) // Descending order
        .slice(0, MAX_URLS_TO_SUBMIT);
}

// =================================================================
// ## Modified Indexing Function
// =================================================================

async function checkAndIndexNewPosts() {
    let results = [];
    try {
        console.log('\n🚀 Starting Smart Google Indexing Check...');
        
        const latestPosts = await getLatestPosts();
        
        if (latestPosts.length === 0) {
            console.log('✅ All posts are already indexed! No new URLs to submit.');
            return;
        }

        // Priority-based filtering
        const postsToSubmit = prioritizeUrls(latestPosts);
        
        console.log(`📦 Smart Selection: Submitting top ${postsToSubmit.length} priority posts`);
        console.log('🎯 Priority order: Newest + Important content first');

        for (const post of postsToSubmit) {
            const postUrl = post.url;
            if (!postUrl) continue;
            
            try {
                const result = await indexUrl(postUrl);
                results.push(result);

                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
            } catch (error) {
                if (error.message.includes('Quota Exceeded')) {
                     results.push({ success: false, url: postUrl, error: 'Quota Exceeded' });
                     break; 
                }
            }
        }
        
        // Summary report with more details
        const submitted = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        const totalNew = latestPosts.length;
        
        console.log(`\n==============================================`);
        console.log(`📊 SMART INDEXING SUMMARY: ${new Date().toLocaleTimeString()}`);
        console.log(`==============================================`);
        console.log(`🔍 New/Unindexed URLs found: ${totalNew}`);
        console.log(`🎯 High-priority URLs submitted: ${postsToSubmit.length}`);
        console.log(`✅ Successfully submitted: ${submitted}`);
        console.log(`❌ Failed: ${failed}`);
        
        if (failed > 0 && results.some(r => r.error && r.error.includes('Quota Exceeded'))) {
            console.log(`🚨 QUOTA EXCEEDED: Remaining URLs will be processed next time`);
        }
        
        console.log(`⭐ Next run: High-priority new content will be checked`);
        console.log(`==============================================`);
    } catch (error) {
        console.error('❌ Critical Indexing Process Error:', error.message);
    }
}

// =================================================================
// ## Environment Variables Setup
// =================================================================

/*
Ab aapko apne environment variables mein yeh add karna hoga:

GOOGLE_SERVICE_ACCOUNT_EMAIL=your-email@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...
BLOG_URL=https://ticnocity.blogspot.com
RSS_FEED_URL=https://ticnocity.blogspot.com/feeds/posts/default?alt=rss
SEARCH_CONSOLE_PROPERTY=sc-domain:ticnocity.blogspot.com

*/

// =================================================================
// ## Mode Selection
// =================================================================

console.log('🚀 Smart Indexer Application Starting...');

// ➡️ MODE A: Single Run (Testing)
/*
checkAndIndexNewPosts(); 
*/

// ➡️ MODE B: Scheduled (Production)
const CHECK_INTERVAL = '0 */3 * * *'; // Har 3 ghante

console.log(`⏰ Smart Scheduler Mode: Priority-based indexing every 3 hours`);

cron.schedule(CHECK_INTERVAL, async () => {
    console.log(`\n\n==============================================`);
    console.log(`🕒 SMART SCHEDULED RUN STARTED...`);
    console.log(`==============================================`);
    await checkAndIndexNewPosts();
});

// Startup pe bhi run karega
checkAndIndexNewPosts();
