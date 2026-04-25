const fs = require('fs');
const crypto = require('crypto');

const key = Buffer.from(process.env.LARAVEL_APP_KEY_BASE64 || 'qt+5BzMtEOkqyEQK4SR21xBe+/yyjE5e1Xv2epgU1ss=', 'base64');
const sql = fs.readFileSync(sqlPath, 'utf8');

function laravelDecrypt(ciphertext) {
  const payload = JSON.parse(Buffer.from(ciphertext, 'base64').toString('utf8'));
  const iv = Buffer.from(payload.iv, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(payload.value, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function readTupleFields(tupleText) {
  const inner = tupleText.trim().replace(/^\(/, '').replace(/\)$/, '');
  const fields = [];
  let current = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index];
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      current += character;
      escaped = true;
      continue;
    }
    if (character === "'") {
      inString = !inString;
      continue;
    }
    if (character === ',' && !inString) {
      fields.push(current.trim() === 'NULL' ? null : current.trim());
      current = '';
      continue;
    }
    current += character;
  }

  fields.push(current.trim() === 'NULL' ? null : current.trim());
  return fields.map((field) => {
    if (field === null) return null;
    if (field.startsWith("'") && field.endsWith("'")) {
      return field.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    }
    return field;
  });
}

const insertStart = sql.indexOf('INSERT INTO `employees`');
if (insertStart < 0) {
  console.error('employees insert not found');
  process.exit(1);
}

const nextInsert = sql.indexOf('INSERT INTO `employees`', insertStart + 1);
const insertChunk = sql.slice(insertStart, nextInsert > 0 ? nextInsert : sql.length);
const valuesStart = insertChunk.indexOf('VALUES');
const valuesText = insertChunk.slice(valuesStart + 6).trim().replace(/;\s*$/, '');

const tuples = [];
let depth = 0;
let inString = false;
let escaped = false;
let current = '';

for (let index = 0; index < valuesText.length; index += 1) {
  const character = valuesText[index];
  current += character;

  if (escaped) {
    escaped = false;
    continue;
  }
  if (character === '\\') {
    escaped = true;
    continue;
  }
  if (character === "'") {
    inString = !inString;
    continue;
  }
  if (!inString) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth === 0 && character === ')') {
      tuples.push(current.trim());
      current = '';
      while (index + 1 < valuesText.length && /[\s,]/.test(valuesText[index + 1])) index += 1;
    }
  }
}

const decrypted = [];
for (const tuple of tuples) {
  const fields = readTupleFields(tuple);
  const id = fields[0];
  const name = fields[1];
  const nikCipher = fields[5];
  if (!nikCipher || nikCipher === 'NULL') continue;

  try {
    decrypted.push({ id, name, nik: laravelDecrypt(nikCipher) });
  } catch (error) {
    decrypted.push({ id, name, nik: '[decrypt failed]' });
  }
}

console.log(JSON.stringify({ count: decrypted.length, sample: decrypted.slice(0, 20) }, null, 2));
