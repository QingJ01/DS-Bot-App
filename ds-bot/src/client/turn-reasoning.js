// Settled and live reasoning of every loaded step in a Turn, shown once on the last
// step that has reasoning: only steps with reasoning get a reasoning part to render
// it. Sitting under the Turn's tool lines keeps the row directly above the reply.
export function turnReasoning(steps, current) {
  const members = steps.length ? steps : [current]
  if (members.findLast(step => stepReasoning(step) !== '')?.step !== current.step) return ''
  return members.map(stepReasoning).filter(Boolean).join('\n\n')
}

// A step still streaming reasoning with no reply text yet is thinking: the row
// counts its clock from `step.time`, the time its first visible chunk arrived.
export const thinkingStep = steps => steps.find(thinkingLive)

const thinkingLive = step => step.status === 'running' && texts(step).length === 0 && step.blocks.some(block => block.kind === 'reasoning')

const texts = step => step.blocks.filter(block => block.kind === 'text' && block.text.trim() !== '')

const stepReasoning = step => step.blocks.filter(block => block.kind === 'reasoning').map(block => block.text).join('\n').trim()
