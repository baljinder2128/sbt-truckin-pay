// Reads start / finish / break times off a runsheet photo with Claude vision.
// Only runs when ANTHROPIC_API_KEY is set; without it drivers type the times in by hand.
const fs = require('fs');

const enabled = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
let client = null;
if (enabled) {
  const Anthropic = require('@anthropic-ai/sdk');
  client = new Anthropic();
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    work_date: { type: ['string', 'null'], description: 'Shift date as YYYY-MM-DD, or null if not visible' },
    start_time: { type: ['string', 'null'], description: 'Shift start, 24h HH:MM' },
    finish_time: { type: ['string', 'null'], description: 'Shift finish, 24h HH:MM' },
    breaks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { start: { type: 'string' }, end: { type: 'string' } },
        required: ['start', 'end'],
      },
    },
    truck_rego: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'], description: 'Anything unclear or worth the driver checking' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['work_date', 'start_time', 'finish_time', 'breaks', 'truck_rego', 'notes', 'confidence'],
};

const PROMPT = `This is a photo of a truck driver's daily runsheet (often handwritten).
Read the shift start time, finish time, every break (start and end), the date, and the truck rego if shown.
Convert all times to 24 hour HH:MM (e.g. "5.30pm" -> "17:30"). If a break is written only as a duration (e.g. "30 min"),
place it at the time written next to it, or leave it out and mention it in notes. Use null for anything you cannot read,
and never guess a time that is not on the sheet. The driver will check and correct your reading before submitting.`;

async function extractRunsheet(filePath, mime) {
  if (!client) return null;
  const data = fs.readFileSync(filePath).toString('base64');
  const media_type = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime) ? mime : 'image/jpeg';
  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type, data } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  });
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
}

module.exports = { extractRunsheet, extractionEnabled: enabled };
