import {expect,test} from 'bun:test';
import {emptyNoteIntroduction,parseNoteIntroductionState,type IntroducedNote} from '../../src/contracts/note-introduction.ts';

test('untrusted introduction packets reject non-string status without invoking coercion or retaining a card',()=>{
  for(const status of [['idle'],{toString:null},null,1,true,{},'unknown']){
    expect(parseNoteIntroductionState({...emptyNoteIntroduction(true),status})).toBeNull();
  }
  expect(parseNoteIntroductionState(emptyNoteIntroduction(true))?.status).toBe('idle');
});
test('introduced note transport keeps complete text and rejects mismatched URLs and invalid source identities',()=>{
  const card:IntroducedNote={presentationId:1,id:'note1',url:'https://social.example.org/notes/note1',instanceUrl:'https://social.example.org',
    userId:'author',username:'author',authorName:'投稿者',userHost:null,text:'全文を保持する。\n'.repeat(2000),createdAt:'2026-11-28T00:00:00.000Z',
    attachmentCount:0,sourceMessageId:'1',sourceChannelId:'2',introducedBy:'紹介者'};
  const state={...emptyNoteIntroduction(true),status:'showing',card};
  expect(parseNoteIntroductionState(state)?.card?.text).toBe(card.text);
  for(const patch of [{url:'javascript:alert(1)'},{url:'https://other.example.org/notes/note1'}, {url:'https://social.example.org/notes/note2'},
    {sourceMessageId:'../1'},{text:'x'.repeat(32769)},{createdAt:'invalid'},{attachmentCount:-1}]){
    expect(parseNoteIntroductionState({...state,card:{...card,...patch}})).toBeNull();
  }
  expect(parseNoteIntroductionState({...state,card:null})).toBeNull();
});
