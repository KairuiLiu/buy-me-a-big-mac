// Preview is deliberately credential-free, even if the shell has MCD_TOKEN set.
process.env.MCD_TOKEN = '';
process.env.LOCAL_PREVIEW = '1';
process.env.LOCAL_DEV = '1';
await import('../server.mjs');
