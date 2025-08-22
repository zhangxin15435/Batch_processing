import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: 'postgresql://sourcing_user:711711@localhost:5432/sourcing' });

async function checkYouTube() {
    try {
        const result = await pool.query('SELECT id, platform, keyword, author, url, title, likes, views, fetched_at FROM youtube_posts ORDER BY fetched_at DESC LIMIT 3');
        console.log('=== 最新YouTube记录 ===');
        result.rows.forEach((row, i) => {
            console.log(`${i + 1}. [${row.platform}] ${row.keyword} - ${row.author} - ${row.title?.substring(0, 50)}`);
            console.log(`   URL: ${row.url}`);
            console.log(`   数据: ❤${row.likes} 👀${row.views} 时间:${row.fetched_at}`);
            console.log('');
        });
    } finally {
        await pool.end();
    }
}

checkYouTube();
