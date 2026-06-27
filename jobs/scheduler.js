// jobs/scheduler.js
//
// Wires the daily absence job to node-cron.
// Require this once from server.js — e.g. `require('./jobs/scheduler');`
// Keeps server.js untouched aside from that single require line,
// consistent with the routes-based architecture already in place.

const cron = require('node-cron');
const { markAbsences } = require('./markAbsences');

// Runs at 15:05 every day, Africa/Johannesburg time — 5 minutes after
// the sign-out window closes (15:00), so late sign-outs aren't
// mistakenly caught mid-window.
cron.schedule('5 15 * * *', async () => {
    try {
        await markAbsences();
    } catch (err) {
        console.error('[scheduler] markAbsences run failed:', err);
    }
}, {
    timezone: 'Africa/Johannesburg'
});

console.log('[scheduler] Daily absence job scheduled for 15:05 Africa/Johannesburg.');