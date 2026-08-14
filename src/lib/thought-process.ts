import type { MessageBlock, ProcessBlock } from './types.ts'

function primitiveBlocks(blocks: readonly MessageBlock[]): ProcessBlock[] {
  return blocks.flatMap(block => block.kind === 'thought' ? block.blocks : [block])
}

/** Keep one answer bubble per turn while preserving every intermediate block. */
export function composeTurnBlocks(steps: readonly (readonly MessageBlock[])[]): MessageBlock[] {
  const populated = steps
    .map(primitiveBlocks)
    .filter(blocks => blocks.length > 0)
  if (populated.length === 0) return []

  let finalStep = -1
  for (let index = populated.length - 1; index >= 0; index -= 1) {
    const blocks = populated[index]
    if (blocks?.some(block => block.kind === 'text' || block.kind === 'image') === true
      && !blocks.some(block => block.kind === 'tool')) {
      finalStep = index
      break
    }
  }

  const thought: ProcessBlock[] = []
  const answer: ProcessBlock[] = []
  populated.forEach((blocks, index) => {
    if (index !== finalStep) {
      thought.push(...blocks)
      return
    }
    blocks.forEach(block => {
      if (block.kind === 'text' || block.kind === 'image') answer.push(block)
      else thought.push(block)
    })
  })
  return [
    ...(thought.length === 0 ? [] : [{ kind: 'thought' as const, blocks: thought }]),
    ...answer,
  ]
}

export function splitTurnBlocks(blocks: readonly MessageBlock[]): {
  thought: ProcessBlock[]
  answer: ProcessBlock[]
} {
  const thought: ProcessBlock[] = []
  const answer: ProcessBlock[] = []
  blocks.forEach(block => {
    if (block.kind === 'thought') thought.push(...block.blocks)
    else answer.push(block)
  })
  return { thought, answer }
}

export function joinTurnBlocks(thought: readonly ProcessBlock[], answer: readonly ProcessBlock[]): MessageBlock[] {
  return [
    ...(thought.length === 0 ? [] : [{ kind: 'thought' as const, blocks: [...thought] }]),
    ...answer,
  ]
}
