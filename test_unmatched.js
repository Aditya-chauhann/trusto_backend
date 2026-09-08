const crypto = require('crypto');
async function test() {
  const secret = 'change-me-callback';
  const body = JSON.stringify({ referenceId: '6a5e59eb9a' }); // dummy
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  
  const res = await fetch('http://localhost:1006/payout-bridge/unmatched', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': signature },
    body
  });
  console.log(res.status);
}
test().catch(console.error);
