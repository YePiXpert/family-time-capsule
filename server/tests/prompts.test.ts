import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHARED, PROMPTS, BANNED_WORDS, ASK_PROMPT, promptIsWellFormed } from '../src/prompts.ts';
for(const [mode,prompt] of Object.entries(PROMPTS))test(`${mode} prompt follows the shared format`,()=>{
 assert.equal(promptIsWellFormed(prompt),true);
});
test('shared preamble names the family book and lists all 19 banned words',()=>{
 assert.ok(SHARED.includes('传家册'));assert.ok(!SHARED.includes('成长相册'));
 assert.equal(BANNED_WORDS.length,19);
 for(const word of BANNED_WORDS)assert.ok(SHARED.includes(word),word);
 assert.ok(ASK_PROMPT.includes('first'));assert.ok(ASK_PROMPT.includes('不超过 30 个汉字'));
});
test('all prompt text matches the manual verbatim',()=>{
 const manual=readFileSync(new URL('../../docs/AI-PROMPTS.md',import.meta.url),'utf8');
 const blocks=[...manual.matchAll(/```text\n([\s\S]*?)\n```/g)].map(match=>match[1]!);
 assert.equal(blocks.length,9);assert.equal(SHARED,blocks[0]);
 Object.values(PROMPTS).forEach((prompt,i)=>assert.equal(prompt,`${SHARED}\n${blocks[i+1]}`));
});
test('static prompt check rejects missing JSON, missing preamble and old wording',()=>{
 for(const prompt of [SHARED,`JSON 格式：{}`,`${SHARED}\nJSON 格式：用户`,`${SHARED}\nJSON 格式：成长相册`])assert.equal(promptIsWellFormed(prompt),false);
});
