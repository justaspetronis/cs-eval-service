const { pool } = require('../db');
const { chatCompletion } = require('../services/proxy');
const { INFERENCE_SYSTEM, buildInferencePrompt } = require('../prompts/inference');
const { extractJson } = require('../lib/parseJson');

const TEMPLATES = [
  {
    name: 'SNAD — Seller: Return approved, insufficient proof',
    category: 'dispute',
    body_raw: `Hello {{member.core_login}},

I'm sorry to hear about this situation.

Unfortunately, we haven't received enough proof that your item(s) matched the listing description before shipping. For this reason, we have approved the item return.

Within 48 hours, please request the buyer to return the order by clicking the "Request a return" button in your conversation with the buyer.

If we don't hear from you within this time, the buyer will be refunded.

To avoid similar situations in the future, we recommend including all details related to your item(s), such as flaws or irregularities, in the listing description.

Check out our Help Centre for more information on how to best describe your items: {{vinted.url}}/help/49

Thank you for understanding.`,
  },
  {
    name: 'SNAD — Buyer: Initial photo request',
    category: 'dispute',
    body_raw: `Hello {{member.core_login}},

Thank you for contacting us.

Please reply to this message with the photos of the item you have received, showing that the item(s) is significantly not as described in the listing. Please make sure that the photos show the entire item and the item is clearly visible from all sides. In order to help you, we need:

• pictures showing the whole item,
• close-up images of the defects from different angles,
• pictures of the whole packaging,
• pictures of the size label/washing label/brand label,
• picture of the shipping label with visible information.

Additionally, please let us know if, upon pick-up, the parcel was damaged, opened or re-taped.

You have 2 days (48 hours) to provide this information. If we don't hear from you within this time, we will complete the transaction, and the payment will be released to the seller.

❗️ It's important to note that the seller might confirm the item return while we are still investigating your dispute. If this happens, it's very important to closely follow the instructions provided in your conversation screen with the seller and send the item back within 5 working days once the seller confirms the item return.

Otherwise, your order will be completed automatically, and money will be released to the seller.

ⓘ If the seller confirms an item return, you will be able to check the precise deadline for returning the order in your conversation screen with the seller.

Talk soon!`,
  },
  {
    name: 'SNAD — Seller: Item ruled not as described, return requested',
    category: 'dispute',
    body_raw: `Hello {{member.core_login}},

After reviewing the available information, we've decided that the item did not match the listing description.

Please request the return within 48 hours by clicking the "Request a return" button in your order.

If you do not request the return within this time, the buyer will receive a refund and keep the item.

To help avoid similar situations in the future, please make sure your listing clearly describes the item. You can find more tips here: {{vinted.url}}/help/49

Thank you for your understanding.`,
  },
  {
    name: 'SNAD — Buyer: Follow-up photo request',
    category: 'dispute',
    body_raw: `Hello {{member.core_login}},

Thank you for your reply.

To continue reviewing this issue, we still need some additional proof from you:
 - photos showing the full item
 - close-up photos of the defects from different angles
 - photos of the external packaging, including any visible outside damage, opening, or re-taping
 - photos of the internal packaging
 - photos of the size label, washing label, or brand label
 - a photo of the shipping label with the details clearly visible

Please send us the information within 48 hours so we can continue investigating. If we don't hear from you by then, we'll continue with the information available and complete the transaction. The payment will then be released to the seller.

The seller may confirm the return while we are still reviewing this issue. If this happens, you will get the necessary instructions.

Waiting for your reply.`,
  },
];

async function inferContext(body_raw) {
  try {
    const raw = await chatCompletion({
      system: INFERENCE_SYSTEM,
      messages: [{ role: 'user', content: buildInferencePrompt(body_raw) }],
      temperature: 0.2,
    });
    return extractJson(raw);
  } catch (e) {
    console.warn('  inference failed, inserting without context:', e.message);
    return null;
  }
}

async function seed() {
  for (const t of TEMPLATES) {
    const { rows: existing } = await pool.query(
      'SELECT id FROM templates WHERE name = $1 AND parent_id IS NULL',
      [t.name]
    );
    if (existing.length > 0) {
      console.log(`  template already exists: ${t.name}`);
      continue;
    }

    console.log(`  inferring context for: ${t.name}`);
    const inferred_context = await inferContext(t.body_raw);

    await pool.query(
      `INSERT INTO templates (name, category, body_raw, inferred_context)
       VALUES ($1, $2, $3, $4)`,
      [t.name, t.category, t.body_raw, JSON.stringify(inferred_context)]
    );
    console.log(`  seeded template: ${t.name}`);
  }
}

module.exports = { seed };
