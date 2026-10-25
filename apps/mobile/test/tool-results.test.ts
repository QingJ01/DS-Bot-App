import test from 'node:test';
import assert from 'node:assert/strict';
import {toolDisplay,hideQuestionReceipt,shouldShowViewCard,toolLabel} from '../src/logic/tool-results.ts';
test('delivered files and workspace summaries render bounded file cards with recorded line counts',()=>{
  const delivery=toolDisplay({name:'present',state:'completed',output:JSON.stringify({files:[{path:'report.pdf',description:'Report'}]})});
  assert.equal(delivery.kind,'file');assert.equal(delivery.rows?.[0].detail,'Report');assert.equal(delivery.body,'');
  const changes=toolDisplay({name:'workspace_changes',state:'completed',output:JSON.stringify({files:[{path:'main.ts',added:4,deleted:2}]})});
  assert.equal(changes.kind,'diff');assert.equal(changes.rows?.[0].detail,'+4 · −2');assert.equal(toolLabel({name:'present',state:'completed'}),'Delivered files');
  assert.equal(toolDisplay({name:'present',state:'error',output:'Could not deliver this file'}).body,'Could not deliver this file');
});
test('tool cards retain meaningful terminal and file details with a generic fallback',()=>{
  assert.equal(toolDisplay({name:'terminal_read',state:'completed',output:JSON.stringify({text:'\u001b[31mfailed\u001b[0m',lineBegin:4,lineEnd:8,totalLines:10})}).body,'failed');
  assert.equal(toolDisplay({name:'read_file',state:'completed',input:'{"path":"src/main.ts"}',output:'{"content":"export const x = 1"}'}).title,'src/main.ts');
  const diff=toolDisplay({name:'edit',state:'running',input:'{"old_string":"before","new_string":"after"}'});assert.equal(diff.rows?.[0].change,'remove');assert.equal(diff.rows?.[1].change,'add');assert.equal(diff.metadata,'Proposed changes');
  assert.equal(toolDisplay({name:'custom_tool',state:'error',output:'unknown format'}).kind,'generic');
});
test('structured searches and tasks render their own records without evaluating results',()=>{
  const search=toolDisplay({name:'web_search',state:'completed',output:'{"results":[{"title":"Source","url":"javascript:alert(1)","snippet":"<script>literal</script>"}]}'});assert.equal(search.rows?.[0].detail,'<script>literal</script>');
  const todos=toolDisplay({name:'todo',state:'completed',output:'{"todos":[{"content":"Done","status":"completed"}]}'});assert.equal(todos.rows?.[0].done,true);
});

test('question receipts defer to the question card while errors and real tool results remain visible',()=>{
  for (const name of ['ask_user','ask_user_question']) {
    assert.equal(hideQuestionReceipt({name,state:'completed'}),true);
    assert.equal(hideQuestionReceipt({name,state:'running'}),false);
    assert.equal(hideQuestionReceipt({name,state:'error'}),false);
    assert.equal(hideQuestionReceipt({name,state:'completed',isError:true}),false);
    assert.equal(toolLabel({name,state:'error'}),'Question request');
  }
  for (const name of ['terminal','read_file','custom_tool','ask_user_history']) assert.equal(hideQuestionReceipt({name,state:'completed'}),false);
  assert.equal(toolLabel({name:'terminal',state:'completed'}),'Terminal');
});
test('successful show_view receipts without a blueprint still render the unavailable-card fallback',()=>{
  for (const output of [
    'The view is on screen.',
    "The view is on screen; the user's answer arrives as their next message.",
  ]) {
    assert.equal(shouldShowViewCard({name:'show_view',state:'completed',output}),true);
    assert.equal(shouldShowViewCard({name:'show_view',state:'completed',output,isError:true}),false);
    assert.equal(shouldShowViewCard({name:'show_view',state:'error',output}),false);
  }
  assert.equal(shouldShowViewCard({name:'show_view',state:'completed',output:'This view was refused.'}),false);
  assert.equal(shouldShowViewCard({name:'show_view',state:'completed',view:{title:'Card',view:{type:'text',text:'Hi'}}}),true);
});
