export type ToolDisplay = { kind: 'terminal'|'file'|'diff'|'search'|'web'|'skill'|'tasks'|'generic'; title: string; body: string; rows?: {title:string;detail?:string;url?:string;done?:boolean;change?:'add'|'remove'}[]; metadata?: string };
const parse = (value?: string): Record<string, any> => { try { const parsed=JSON.parse(value || ''); return parsed && typeof parsed==='object' ? parsed : {}; } catch { return {}; } };
const stripAnsi = (value: string) => value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
const text = (value: unknown, max=12000) => typeof value==='string' ? value.slice(0,max) : '';
export function toolDisplay(tool: {name:string;input?:string;output?:string;state:string}): ToolDisplay {
  const input=parse(tool.input), output=parse(tool.output), name=tool.name.toLowerCase();
  const path=text(input.path || input.file_path || input.file || output.path,500);
  const body=text(tool.output).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'');
  const base={title:tool.name,body};
  if (name === 'present' || name === 'workspace_changes') {
    if (!Array.isArray(output.files)) return { ...base, kind: name === 'present' ? 'file' : 'diff', title: name === 'present' ? 'Delivered files' : 'File changes' };
    return { ...base, kind: name === 'present' ? 'file' : 'diff', body: '', title: name === 'present' ? 'Delivered files' : 'File changes',
      rows: Array.isArray(output.files) ? output.files.filter((file:any)=>typeof file?.path === 'string').slice(0,100).map((file:any)=>({title:text(file.path,4096),detail:name==='present'?text(file.description,2000):[Number.isSafeInteger(file.added)?`+${file.added}`:'',Number.isSafeInteger(file.deleted)?`−${file.deleted}`:''].filter(Boolean).join(' · ')})) : undefined };
  }
  if (/terminal|^bash$|^shell$|^exec_command$/.test(name)) return {...base,kind:'terminal',body:stripAnsi(text(output.text || output.viewport)) || body,metadata:[output.waitReason,output.sessionStatus,output.lineBegin !== undefined ? `${output.lineBegin}–${output.lineEnd} / ${output.totalLines}` : '', typeof output.exitCode==='number' ? `exit ${output.exitCode}`:''].filter(value=>typeof value==='string').join(' · ')};
  if (/^(edit|write|apply_patch)|file.*(edit|write)/.test(name)) {
    const before=text(input.old_string || input.oldText || input.old), after=text(input.new_string || input.newText || input.new || input.content);
    const diff=text(output.diff || input.patch);
    const rows=diff ? diff.split('\n').map(line=>({title:line,change:line.startsWith('+')?'add' as const:line.startsWith('-')?'remove' as const:undefined})) : [...before.split('\n').filter(()=>!!before).map(line=>({title:'− '+line,change:'remove' as const})),...after.split('\n').filter(()=>!!after).map(line=>({title:'+ '+line,change:'add' as const}))];
    return {...base,kind:'diff',title:path || tool.name,rows:rows.slice(0,300),metadata:tool.state==='completed'?"Changes applied":tool.state==='error'?"Changes failed":"Proposed changes"};
  }
  if (/^read$|read_file|file_read/.test(name)) return {...base,kind:'file',title:path || tool.name,body:text(output.content || output.text) || body};
  if (/search|grep|find/.test(name)) {
    const results=output.results || output.hits || output.matches;
    return {...base,kind:/web|search_web/.test(name)?'web':'search',rows:Array.isArray(results)?results.slice(0,60).map((hit:any)=>typeof hit==='string'?{title:hit}:{title:text(hit.title || hit.path || hit.file || hit.url,500),detail:text(hit.snippet || hit.text || hit.content,2000),url:text(hit.url,2000)}):undefined};
  }
  if (/browser|fetch|web/.test(name)) return {...base,kind:'web',title:text(output.title,500)||tool.name,body:text(output.text || output.content)||body,rows:output.url?[{title:text(output.url,2000),url:text(output.url,2000)}]:undefined};
  if (/skill/.test(name)) return {...base,kind:'skill',body:text(output.content || output.instructions)||body};
  if (/todo|task.*list/.test(name)) {
    const todos=output.todos || output.tasks || input.todos;
    return {...base,kind:'tasks',rows:Array.isArray(todos)?todos.slice(0,100).map((task:any)=>({title:text(task.content || task.title || task.text,1000),detail:text(task.status,50),done:task.status==='completed' || task.done===true})):undefined};
  }
  return {...base,kind:'generic'};
}

export function isQuestionTool(name: string): boolean {
  return name === 'ask_user' || name === 'ask_user_question';
}
const SHOW_VIEW_RECEIPTS = new Set([
  'The view is on screen.',
  "The view is on screen; the user's answer arrives as their next message.",
]);
export function shouldShowViewCard(tool: {name:string;state:string;isError?:boolean;output?:string;view?:unknown}): boolean {
  return tool.name === 'show_view' && tool.state === 'completed' && tool.isError !== true
    && (tool.view !== undefined || SHOW_VIEW_RECEIPTS.has(tool.output ?? ''));
}
// The question card owns these interactions. Keep failures visible for diagnosis.
export function hideQuestionReceipt(tool: {name:string;state:string;isError?:boolean}): boolean {
  return isQuestionTool(tool.name) && tool.state === 'completed' && !tool.isError;
}
export function toolLabel(tool: {name:string;input?:string;output?:string;state:string}): string {
  if (tool.name === 'present') return 'Delivered files';
  if (isQuestionTool(tool.name)) return 'Question request';
  return {terminal:'Terminal',file:'File',diff:'File changes',search:'Search',web:'Web page',skill:'Skill',tasks:'Tasks',generic:'Tool result'}[toolDisplay(tool).kind];
}
