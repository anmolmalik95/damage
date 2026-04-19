import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const SYSTEM_PROMPT = `You are a precise receipt parser. Your job is to extract data EXACTLY as printed on the receipt — do not calculate or estimate any values.

Rules:
- Read each line item's price EXACTLY as printed — do not round, estimate or calculate
- For items that appear multiple times as separate lines (e.g. 3 separate lines of 'Peroni 500ml' at $14 each), consolidate them into one item with quantity 3 and unitPrice 14
- Read the SUBTOTAL line exactly as printed
- Read the GST/tax amount exactly as printed — do not calculate it
- Read the service charge amount exactly as printed — do not calculate it
- Read the TOTAL exactly as printed at the bottom
- Return all monetary values as numbers without currency symbols
- If multiple photos are provided for one venue they are parts of the same receipt — combine them into one list of items, deduplicating any items that appear in the overlap between photos
- Never include GST or service charge as line items — they belong in the gst and serviceCharge fields only

CRITICAL: Read prices character by character — do not guess or infer prices from context. If a price is ambiguous or unclear, read the digits you can see and note uncertainty. Thermal receipt fonts often have digits that look similar: 1/7, 8/6, 2/7, 3/8 — look carefully at each digit. The subtotal printed on the receipt is ground truth — your item prices should sum to exactly that subtotal.

Return this exact JSON structure:
{
  "items": [{ "name": "string", "quantity": "number", "unitPrice": "number" }],
  "subtotal": "number",
  "gst": { "present": "boolean", "percent": "number | null", "amount": "number | null" },
  "serviceCharge": { "present": "boolean", "percent": "number | null", "amount": "number | null" },
  "receiptTotal": "number"
}`;

app.post('/api/parse-receipt', async (req, res) => {
  console.log('Received parse request — sessionId:', req.body?.sessionId, 'venues:', req.body?.venues?.length);

  const { sessionId, venues } = req.body;

  if (!sessionId || !Array.isArray(venues) || venues.length === 0) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const results = await Promise.all(
      venues.map(async ({ venueIndex, venueName, photos }) => {
        const imageMessages = photos.map(base64 => ({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'high' },
        }));

        const messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Parse this receipt for venue: ${venueName}` },
              ...imageMessages,
            ],
          },
        ];

        let response = await client.chat.completions.create({
          model: 'gpt-4o', messages, response_format: { type: 'json_object' },
        });
        let parsed = JSON.parse(response.choices[0].message.content);

        // Self-correction: if item sum differs from parsed subtotal by more than $1, re-prompt
        const itemSum = (parsed.items || []).reduce((s, i) => s + (i.quantity * i.unitPrice), 0);
        const subtotal = parsed.subtotal ?? 0;
        if (Math.abs(itemSum - subtotal) > 1) {
          console.log(`[${venueName}] Item sum $${itemSum.toFixed(2)} ≠ subtotal $${subtotal.toFixed(2)} — re-prompting`);
          messages.push(
            { role: 'assistant', content: response.choices[0].message.content },
            { role: 'user', content: `Your parsed items sum to $${itemSum.toFixed(2)} but the receipt shows subtotal $${subtotal.toFixed(2)}. Please re-examine each item price carefully and correct any misread digits.` }
          );
          response = await client.chat.completions.create({
            model: 'gpt-4o', messages, response_format: { type: 'json_object' },
          });
          parsed = JSON.parse(response.choices[0].message.content);
        }

        return { venueIndex, venueName, ...parsed };
      })
    );

    return res.status(200).json({ venues: results });
  } catch (err) {
    console.error('Parse error:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
});

const server = app.listen(3001, () => {
  console.log('API server running on http://localhost:3001');
  console.log('Server is running and waiting for requests...');
});

server.on('error', err => console.error('Server error:', err.message, err.stack));
