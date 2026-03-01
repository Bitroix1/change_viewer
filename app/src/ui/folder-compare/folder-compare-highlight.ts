/**
 * DOM highlighting helpers for the folder-compare view.
 *
 * All functions are pure wrt React state — they only touch the DOM.
 * Callers pass the necessary state slices as arguments.
 */

/**
 * Strip `cm-diff-delete-inner` / `cm-diff-add-inner` classes from all spans
 * inside `container`, so that the SCSS rule
 *   `.cm-s-default .cm-diff-delete-inner { color: ... !important }`
 * no longer matches. A data attribute records the removed class so
 * `restoreDiffInnerClasses` can put it back during cleanup.
 */
function stripDiffInnerClasses(container: HTMLElement): void {
  container
    .querySelectorAll('.cm-diff-delete-inner, .cm-diff-add-inner')
    .forEach(el => {
      const classes: string[] = []
      if (el.classList.contains('cm-diff-delete-inner')) {
        classes.push('cm-diff-delete-inner')
        el.classList.remove('cm-diff-delete-inner')
      }
      if (el.classList.contains('cm-diff-add-inner')) {
        classes.push('cm-diff-add-inner')
        el.classList.remove('cm-diff-add-inner')
      }
      if (classes.length > 0) {
        ;(el as HTMLElement).dataset.diffInnerSaved = classes.join(' ')
      }
    })
}

/**
 * Restore `cm-diff-delete-inner` / `cm-diff-add-inner` classes that were
 * removed by `stripDiffInnerClasses`.
 */
function restoreDiffInnerClasses(container: HTMLElement): void {
  container
    .querySelectorAll('[data-diff-inner-saved]')
    .forEach(el => {
      const saved = (el as HTMLElement).dataset.diffInnerSaved
      if (saved) {
        saved.split(' ').forEach(cls => el.classList.add(cls))
        delete (el as HTMLElement).dataset.diffInnerSaved
      }
    })
}

import * as fs from 'fs'
import * as Path from 'path'
import { WorkingDirectoryFileChange } from '../../models/status'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HighlightSide = 'before' | 'after'

export interface LineHighlight {
  line: number
  side: HighlightSide
  ranges: Array<{ startCol: number; endCol: number }>
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Check whether a relative file name from JSON matches a full/relative path. */
function pathMatchesFile(jsonFile: string, fullPath: string): boolean {
  return (
    fullPath === jsonFile ||
    fullPath.endsWith('/' + jsonFile) ||
    fullPath.endsWith('\\' + jsonFile)
  )
}

/**
 * Collect ALL line numbers claimed by ANY component for a given file.
 * Used by the "Miscellaneous" view to determine which changed lines are
 * unclaimed (and therefore belong to misc).
 */
export function getClaimedLineNumbers(
  diffComponents: any[],
  filePath: string
): Set<number> {
  const claimed = new Set<number>()
  for (const comp of diffComponents) {
    if (!comp.changes) continue
    for (const change of comp.changes) {
      if (change.from && pathMatchesFile(change.from.file, filePath) && change.from.position) {
        const line = parseInt(change.from.position.split(':')[0], 10)
        if (!isNaN(line)) claimed.add(line)
      }
      if (change.to && pathMatchesFile(change.to.file, filePath) && change.to.position) {
        const line = parseInt(change.to.position.split(':')[0], 10)
        if (!isNaN(line)) claimed.add(line)
      }
    }
  }
  return claimed
}

/** The expand-context SVG path data (GitHub's unfold / expand icon). */
const EXPAND_SVG_PATH =
  'm8.177.677 2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25a.75.75 0 0 1-1.5 0V4H5.104a.25.25 0 0 1-.177-.427L7.823.677a.25.25 0 0 1 .354 0ZM7.25 10.75a.75.75 0 0 1 1.5 0V12h2.146a.25.25 0 0 1 .177.427l-2.896 2.896a.25.25 0 0 1-.354 0l-2.896-2.896A.25.25 0 0 1 5.104 12H7.25v-1.25Zm-5-2a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5Z'

/**
 * Build the SVG element used as the expand-context icon.
 * Shared between component-hunk-separators and "Show All" hunk-info rows.
 */
export function createExpandSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'currentColor')
  svg.classList.add('expand-context-icon')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', EXPAND_SVG_PATH)
  svg.appendChild(path)
  return svg
}

/** Create a @@ hunk separator DOM element with an expand-context button. */
function createSeparatorElement(): HTMLDivElement {
  const separator = document.createElement('div')
  separator.className = 'component-hunk-separator hunk-info row'
  separator.setAttribute('role', 'cell')
  const expansionHandle = document.createElement('div')
  expansionHandle.className = 'hunk-expansion-handle'
  expansionHandle.style.width = '35px'
  // Expand button
  const expandBtn = document.createElement('button')
  expandBtn.className = 'expand-context-btn'
  expandBtn.title = 'Expand context'
  expandBtn.appendChild(createExpandSvg())
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    const sep = (e.currentTarget as HTMLElement).closest('.component-hunk-separator') as HTMLElement
    if (sep) {
      // Dispatch event for the view to handle both hidden-row reveal and
      // source-file gap insertion.
      sep.dispatchEvent(
        new CustomEvent('expand-hunk-context', {
          bubbles: true,
          detail: { outerWrapper: sep, isComponentSeparator: true },
        })
      )
    }
  })
  expansionHandle.appendChild(expandBtn)
  const contentDiv = document.createElement('div')
  contentDiv.className = 'content'
  const prefix = document.createElement('div')
  prefix.className = 'prefix'
  prefix.innerHTML = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'
  const contentWrapper = document.createElement('div')
  contentWrapper.className = 'content-wrapper'
  contentWrapper.textContent = '@@'
  contentDiv.appendChild(prefix)
  contentDiv.appendChild(contentWrapper)
  const contentDiv2 = document.createElement('div')
  contentDiv2.className = 'content'
  contentDiv2.style.display = 'flex'
  const prefix2 = document.createElement('div')
  prefix2.className = 'prefix'
  prefix2.innerHTML = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'
  const contentWrapper2 = document.createElement('div')
  contentWrapper2.className = 'content-wrapper'
  contentWrapper2.textContent = '@@       '
  contentWrapper2.style.flex = '1'
  contentWrapper2.style.textAlign = 'right'
  contentDiv2.appendChild(prefix2)
  contentDiv2.appendChild(contentWrapper2)
  separator.appendChild(expansionHandle)
  separator.appendChild(contentDiv)
  separator.appendChild(contentDiv2)
  return separator
}

/**
 * Extract the source-file line number from a `.line-number` element.
 * The label's `for` attribute has the format "{lineNumber}-before|after".
 */
export function extractLineNumber(lineNumberDiv: Element): number | null {
  const label = lineNumberDiv.querySelector('label')
  if (!label) return null
  const htmlFor = label.getAttribute('for')
  if (!htmlFor) return null
  const match = htmlFor.match(/^(\d+)-(before|after)$/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Parse a position string like "5:12-13" and add it to the line map.
 * Format: "line:startCol-endCol" (0-based cols, endCol exclusive).
 */
export function addPositionToLineMap(
  lineMap: Map<string, LineHighlight>,
  position: string,
  side: HighlightSide
): void {
  const parts = position.split(':')
  if (parts.length < 2) return
  const lineNum = parseInt(parts[0], 10)
  const colParts = parts[1].split('-')
  if (colParts.length < 2) return
  const startCol = parseInt(colParts[0], 10)
  const endCol = parseInt(colParts[1], 10)
  if (endCol <= startCol) return
  const key = `${lineNum}-${side}`
  const existing = lineMap.get(key)
  if (existing) {
    existing.ranges.push({ startCol, endCol })
  } else {
    lineMap.set(key, { line: lineNum, side, ranges: [{ startCol, endCol }] })
  }
}

// ---------------------------------------------------------------------------
// Component highlight computation
// ---------------------------------------------------------------------------

/**
 * Return all highlighted lines (with column ranges) for the selected component
 * in the given file.
 */
export function getHighlightedLinesForComponent(
  diffComponents: any[],
  selectedComponent: number | 'all' | 'misc',
  filePath: string
): LineHighlight[] {
  if (selectedComponent === 'all' || selectedComponent === 'misc') return []
  const component = diffComponents[selectedComponent as number]
  if (!component || !component.changes) return []

  const lineMap = new Map<string, LineHighlight>()

  for (const change of component.changes) {
    const side: HighlightSide = change.kind === 'Removal' ? 'before' : 'after'
    if (change.from && pathMatchesFile(change.from.file, filePath) && change.from.position) {
      addPositionToLineMap(lineMap, change.from.position, side)
    }
    if (change.to && pathMatchesFile(change.to.file, filePath) && change.to.position) {
      addPositionToLineMap(lineMap, change.to.position, side)
    }
  }

  return Array.from(lineMap.values())
}

/**
 * Compute merged hunk ranges (±CONTEXT lines) for the selected component in a
 * file.  Returns separate ranges for the before and after sides.
 */
export function computeComponentHunkRanges(
  filePath: string,
  diffComponents: any[],
  selectedComponent: number | 'all'
): { beforeRanges: Array<[number, number]>; afterRanges: Array<[number, number]> } {
  const CONTEXT = 3
  const highlights = getHighlightedLinesForComponent(
    diffComponents,
    selectedComponent,
    filePath
  )

  const beforeLines = new Set<number>()
  const afterLines = new Set<number>()
  for (const h of highlights) {
    if (h.side === 'before') beforeLines.add(h.line)
    else afterLines.add(h.line)
  }

  const expandAndMerge = (lines: Set<number>): Array<[number, number]> => {
    if (lines.size === 0) return []
    const sorted = Array.from(lines).sort((a, b) => a - b)
    const ranges: Array<[number, number]> = []
    let start = Math.max(1, sorted[0] - CONTEXT)
    let end = sorted[0] + CONTEXT
    for (let i = 1; i < sorted.length; i++) {
      const newStart = Math.max(1, sorted[i] - CONTEXT)
      const newEnd = sorted[i] + CONTEXT
      if (newStart <= end + 1) {
        end = Math.max(end, newEnd)
      } else {
        ranges.push([start, end])
        start = newStart
        end = newEnd
      }
    }
    ranges.push([start, end])
    return ranges
  }

  return { beforeRanges: expandAndMerge(beforeLines), afterRanges: expandAndMerge(afterLines) }
}

// ---------------------------------------------------------------------------
// Character-level highlights
// ---------------------------------------------------------------------------

/**
 * Add absolutely-positioned overlay spans on a `content-wrapper` element to
 * highlight specific character column ranges.  Uses monospace `ch` units.
 *
 * Also walks the inline text nodes / cm-* spans and wraps characters that
 * fall within a highlight range with `<span class="component-char-white">`
 * so they render in white on top of the bright overlay.
 */
export function addCharHighlights(
  contentWrapper: HTMLElement,
  ranges: Array<{ startCol: number; endCol: number }>,
  side: HighlightSide,
  handleCharHighlightClick: (e: Event) => void
): void {
  contentWrapper.style.position = 'relative'
  contentWrapper.style.zIndex = '0' // stacking context so z-index:-1 overlays sit below text

  const highlightClass =
    side === 'before'
      ? 'component-char-highlight component-highlight-delete'
      : 'component-char-highlight component-highlight-add'

  const seen = new Set<string>()
  for (const range of ranges) {
    if (range.endCol <= range.startCol) continue
    const key = `${range.startCol}-${range.endCol}`
    if (seen.has(key)) continue
    seen.add(key)

    const overlay = document.createElement('span')
    overlay.className = highlightClass
    overlay.style.left = `${range.startCol}ch`
    overlay.style.width = `${range.endCol - range.startCol}ch`
    contentWrapper.appendChild(overlay)

    const clickCapture = document.createElement('span')
    clickCapture.className = 'component-char-click-capture'
    clickCapture.style.position = 'absolute'
    clickCapture.style.left = `${range.startCol}ch`
    clickCapture.style.width = `${range.endCol - range.startCol}ch`
    clickCapture.style.top = '0'
    clickCapture.style.bottom = '0'
    clickCapture.style.zIndex = '2'
    clickCapture.style.cursor = 'pointer'
    clickCapture.dataset.startCol = String(range.startCol)
    clickCapture.dataset.endCol = String(range.endCol)
    clickCapture.dataset.side = side
    clickCapture.addEventListener('mousedown', handleCharHighlightClick)
    contentWrapper.appendChild(clickCapture)
  }

  // --- White-out text within highlight ranges ---
  // Build a merged list of highlighted columns for quick lookup.
  const highlightedCols = new Set<number>()
  for (const range of ranges) {
    for (let c = range.startCol; c < range.endCol; c++) {
      highlightedCols.add(c)
    }
  }
  if (highlightedCols.size === 0) return

  // Walk only the original inline children (text nodes + cm-* spans).
  // Skip the absolutely-positioned overlays / click-capture spans.
  const inlineNodes: Node[] = []
  for (const child of Array.from(contentWrapper.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement
      if (
        el.classList.contains('component-char-highlight') ||
        el.classList.contains('component-char-click-capture')
      ) {
        continue
      }
    }
    inlineNodes.push(child)
  }

  let charOffset = 0
  for (const node of inlineNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      charOffset = whiteOutTextNode(
        node as Text,
        charOffset,
        highlightedCols,
        contentWrapper
      )
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // cm-* span — process its child text nodes
      const el = node as HTMLElement
      const textChildren = Array.from(el.childNodes).filter(
        c => c.nodeType === Node.TEXT_NODE
      ) as Text[]
      for (const textChild of textChildren) {
        charOffset = whiteOutTextNode(
          textChild,
          charOffset,
          highlightedCols,
          el
        )
      }
    }
  }
}

/**
 * Split a text node so that characters within `highlightedCols` are wrapped
 * in `<span class="component-char-white">`.  Returns the updated charOffset.
 */
function whiteOutTextNode(
  textNode: Text,
  startOffset: number,
  highlightedCols: Set<number>,
  parent: Node
): number {
  const text = textNode.textContent || ''
  if (text.length === 0) return startOffset

  // Build runs of consecutive highlighted / non-highlighted characters.
  const runs: Array<{ start: number; end: number; highlighted: boolean }> = []
  let runStart = 0
  let runHighlighted = highlightedCols.has(startOffset)
  for (let i = 0; i < text.length; i++) {
    const col = startOffset + i
    const isHL = highlightedCols.has(col)
    if (isHL !== runHighlighted) {
      runs.push({ start: runStart, end: i, highlighted: runHighlighted })
      runStart = i
      runHighlighted = isHL
    }
  }
  runs.push({ start: runStart, end: text.length, highlighted: runHighlighted })

  // If the entire text is non-highlighted, nothing to do.
  if (runs.length === 1 && !runs[0].highlighted) {
    return startOffset + text.length
  }

  // Replace the text node with a mix of plain text and white spans.
  const frag = document.createDocumentFragment()
  for (const run of runs) {
    const slice = text.substring(run.start, run.end)
    if (run.highlighted) {
      const span = document.createElement('span')
      span.className = 'component-char-white'
      span.textContent = slice
      frag.appendChild(span)
    } else {
      frag.appendChild(document.createTextNode(slice))
    }
  }
  parent.replaceChild(frag, textNode)

  return startOffset + text.length
}

// ---------------------------------------------------------------------------
// Per-file highlighting
// ---------------------------------------------------------------------------

export function applyComponentHighlightingForFile(
  filePath: string,
  diffComponents: any[],
  selectedComponent: number | 'all' | 'misc',
  handleCharHighlightClick: (e: Event) => void
): void {
  const fileContainer = document.querySelector(
    `.folder-compare-view [data-file-path="${filePath}"]`
  )
  if (!fileContainer) return

  // --- cleanup previous state ---
  fileContainer.querySelectorAll('.component-char-highlight').forEach(el => el.remove())
  fileContainer.querySelectorAll('.component-char-click-capture').forEach(el => el.remove())
  // Unwrap white-text spans back to plain text nodes
  fileContainer.querySelectorAll('.component-char-white').forEach(el => {
    const parent = el.parentNode
    if (parent) {
      const text = document.createTextNode(el.textContent || '')
      parent.replaceChild(text, el)
      parent.normalize() // merge adjacent text nodes
    }
  })
  fileContainer.querySelectorAll('.component-hunk-separator').forEach(el => el.remove())
  fileContainer.querySelectorAll('.expanded-context-row').forEach(el => el.remove())
  fileContainer.querySelectorAll('.expand-boundary-bottom').forEach(el => el.remove())
  fileContainer.querySelectorAll('.hunk-expanded').forEach(el => {
    el.classList.remove('hunk-expanded')
    // Restore the original top position (we pushed it off-screen)
    const htmlEl = el as HTMLElement
    if (htmlEl.dataset.originalTop !== undefined) {
      htmlEl.style.top = htmlEl.dataset.originalTop
    }
    const btn = el.querySelector('.expand-context-btn') as HTMLElement
    if (btn) btn.style.display = ''
  })
  fileContainer.querySelectorAll('.component-char-filtered').forEach(el => {
    el.classList.remove('component-char-filtered')
    const cw = el.querySelector('.content-wrapper') as HTMLElement
    if (cw) { cw.style.position = ''; cw.style.zIndex = '' }
  })
  fileContainer.querySelectorAll('.component-hidden').forEach(el =>
    el.classList.remove('component-hidden')
  )
  fileContainer.querySelectorAll('.component-packed').forEach(el =>
    el.classList.remove('component-packed')
  )
  fileContainer.querySelectorAll('.component-hunk-start').forEach(el =>
    el.classList.remove('component-hunk-start')
  )
  fileContainer.querySelectorAll('.component-filtered').forEach(el =>
    el.classList.remove('component-filtered')
  )
  fileContainer.querySelectorAll('.component-filtered-side').forEach(el =>
    el.classList.remove('component-filtered-side')
  )

  // Restore cm-diff-delete-inner / cm-diff-add-inner classes that were
  // stripped during component highlighting
  restoreDiffInnerClasses(fileContainer as HTMLElement)

  // ── Miscellaneous mode: show changed rows NOT in any component ───────────
  if (selectedComponent === 'misc') {
    const claimedLines = getClaimedLineNumbers(diffComponents, filePath)
    const CONTEXT = 3
    const rowsArray = Array.from(fileContainer.querySelectorAll('.row')) as HTMLElement[]

    // Anchors = changed rows where neither side's line is claimed
    const anchorIndices = new Set<number>()
    rowsArray.forEach((row, idx) => {
      if (row.classList.contains('hunk-info')) return
      const isChanged =
        row.classList.contains('modified') ||
        row.classList.contains('added') ||
        row.classList.contains('deleted')
      if (!isChanged) return
      const blDiv = row.querySelector('.before .line-number')
      const alDiv = row.querySelector('.after .line-number')
      const bl = blDiv ? extractLineNumber(blDiv) : null
      const al = alDiv ? extractLineNumber(alDiv) : null
      const beforeClaimed = bl !== null && claimedLines.has(bl)
      const afterClaimed = al !== null && claimedLines.has(al)
      if (!beforeClaimed && !afterClaimed) {
        anchorIndices.add(idx)
      }
    })

    if (anchorIndices.size === 0) {
      fileContainer.classList.add('component-file-hidden')
      return
    }
    fileContainer.classList.remove('component-file-hidden')

    const visibleIndices = new Set<number>()
    for (const anchorIdx of anchorIndices) {
      for (let d = -CONTEXT; d <= CONTEXT; d++) {
        const i = anchorIdx + d
        if (i >= 0 && i < rowsArray.length) visibleIndices.add(i)
      }
    }

    const sortedVisible = Array.from(visibleIndices).sort((a, b) => a - b)
    const needsSeparatorBefore = new Set<number>()
    for (let i = 1; i < sortedVisible.length; i++) {
      if (sortedVisible[i] - sortedVisible[i - 1] > 1) {
        needsSeparatorBefore.add(sortedVisible[i])
      }
    }

    let isFirstVisibleRow = true
    rowsArray.forEach((htmlRow, idx) => {
      if (htmlRow.classList.contains('hunk-info')) {
        ;(htmlRow.parentElement ?? htmlRow).classList.add('component-hidden')
        return
      }
      if (!visibleIndices.has(idx)) {
        ;(htmlRow.parentElement ?? htmlRow).classList.add('component-hidden')
        return
      }
      ;(htmlRow.parentElement ?? htmlRow).classList.remove('component-hidden')

      if (isFirstVisibleRow || needsSeparatorBefore.has(idx)) {
        htmlRow.classList.add('component-hunk-start')
        const separator = createSeparatorElement()
        const outerWrapper = htmlRow.parentElement
        outerWrapper?.parentElement?.insertBefore(separator, outerWrapper)
      } else {
        htmlRow.classList.remove('component-hunk-start')
      }
      isFirstVisibleRow = false
      // No char highlights or filtering for misc — show rows as-is
    })
    return
  }

  const highlights = getHighlightedLinesForComponent(diffComponents, selectedComponent, filePath)

  if (highlights.length === 0) {
    fileContainer.classList.add('component-file-hidden')
    return
  }
  fileContainer.classList.remove('component-file-hidden')

  // Build per-line column maps
  const beforeHighlights = new Map<number, Array<{ startCol: number; endCol: number }>>()
  const afterHighlights = new Map<number, Array<{ startCol: number; endCol: number }>>()
  for (const h of highlights) {
    const map = h.side === 'before' ? beforeHighlights : afterHighlights
    const existing = map.get(h.line)
    if (existing) {
      existing.push(...h.ranges)
    } else {
      map.set(h.line, [...h.ranges])
    }
  }

  // ── Pass 1: find anchor row indices ─────────────────────────────────────
  // An "anchor" is a DOM row that directly contains a char-highlighted source
  // line.  We expand ±CONTEXT DOM rows around each anchor for context, rather
  // than expanding ±CONTEXT *source lines* on each side independently.  The
  // source-line approach over-counts context when before/after line numbers
  // are offset (e.g. before:135 vs after:147) because both sides' window are
  // active simultaneously, producing far more than CONTEXT visible rows.
  const CONTEXT = 3
  const rowsArray = Array.from(fileContainer.querySelectorAll('.row')) as HTMLElement[]

  const anchorIndices = new Set<number>()
  rowsArray.forEach((row, idx) => {
    if (row.classList.contains('hunk-info')) return
    const blDiv = row.querySelector('.before .line-number')
    const alDiv = row.querySelector('.after .line-number')
    const bl = blDiv ? extractLineNumber(blDiv) : null
    const al = alDiv ? extractLineNumber(alDiv) : null
    if (
      (bl !== null && beforeHighlights.has(bl)) ||
      (al !== null && afterHighlights.has(al))
    ) {
      anchorIndices.add(idx)
    }
  })

  // ── Pass 2: expand anchors → visible set; locate separator positions ─────
  const visibleIndices = new Set<number>()
  for (const anchorIdx of anchorIndices) {
    for (let d = -CONTEXT; d <= CONTEXT; d++) {
      const i = anchorIdx + d
      if (i >= 0 && i < rowsArray.length) visibleIndices.add(i)
    }
  }

  // A separator is needed before any visible row whose index does not
  // immediately follow the previous visible row's index.
  const sortedVisible = Array.from(visibleIndices).sort((a, b) => a - b)
  const needsSeparatorBefore = new Set<number>()
  for (let i = 1; i < sortedVisible.length; i++) {
    if (sortedVisible[i] - sortedVisible[i - 1] > 1) {
      needsSeparatorBefore.add(sortedVisible[i])
    }
  }

  // ── Pass 3: apply visibility, separators, and char highlights ────────────
  let isFirstVisibleRow = true

  rowsArray.forEach((htmlRow, idx) => {
    // Always hide original git hunk-info rows
    if (htmlRow.classList.contains('hunk-info')) {
      ;(htmlRow.parentElement ?? htmlRow).classList.add('component-hidden')
      return
    }

    if (!visibleIndices.has(idx)) {
      ;(htmlRow.parentElement ?? htmlRow).classList.add('component-hidden')
      return
    }

    ;(htmlRow.parentElement ?? htmlRow).classList.remove('component-hidden')

    // Insert a visual hunk separator at the top of every hunk (including the first).
    if (isFirstVisibleRow || needsSeparatorBefore.has(idx)) {
      htmlRow.classList.add('component-hunk-start')
      const separator = createSeparatorElement()
      const outerWrapper = htmlRow.parentElement
      outerWrapper?.parentElement?.insertBefore(separator, outerWrapper)
    } else {
      htmlRow.classList.remove('component-hunk-start')
    }

    isFirstVisibleRow = false

    const beforeLineNumDiv = htmlRow.querySelector('.before .line-number')
    const afterLineNumDiv = htmlRow.querySelector('.after .line-number')
    const beforeLine = beforeLineNumDiv ? extractLineNumber(beforeLineNumDiv) : null
    const afterLine = afterLineNumDiv ? extractLineNumber(afterLineNumDiv) : null

    const isChanged =
      htmlRow.classList.contains('modified') ||
      htmlRow.classList.contains('added') ||
      htmlRow.classList.contains('deleted')

    if (!isChanged) return

    const beforeRangesForLine = beforeLine !== null ? beforeHighlights.get(beforeLine) : undefined
    const afterRangesForLine = afterLine !== null ? afterHighlights.get(afterLine) : undefined

    const beforeSide = htmlRow.querySelector('.before') as HTMLElement
    const afterSide = htmlRow.querySelector('.after') as HTMLElement

    if (beforeSide) {
      if (beforeRangesForLine && beforeRangesForLine.length > 0) {
        beforeSide.classList.remove('component-filtered-side')
        beforeSide.classList.add('component-char-filtered')
        const cw = beforeSide.querySelector('.content-wrapper') as HTMLElement
        if (cw) addCharHighlights(cw, beforeRangesForLine, 'before', handleCharHighlightClick)
        stripDiffInnerClasses(beforeSide)
      } else {
        beforeSide.classList.add('component-filtered-side')
        beforeSide.classList.remove('component-char-filtered')
        stripDiffInnerClasses(beforeSide)
      }
    }

    if (afterSide) {
      if (afterRangesForLine && afterRangesForLine.length > 0) {
        afterSide.classList.remove('component-filtered-side')
        afterSide.classList.add('component-char-filtered')
        const cw = afterSide.querySelector('.content-wrapper') as HTMLElement
        if (cw) addCharHighlights(cw, afterRangesForLine, 'after', handleCharHighlightClick)
        stripDiffInnerClasses(afterSide)
      } else {
        afterSide.classList.add('component-filtered-side')
        afterSide.classList.remove('component-char-filtered')
        stripDiffInnerClasses(afterSide)
      }
    }

    if (!beforeRangesForLine && !afterRangesForLine) {
      htmlRow.classList.add('component-filtered')
      stripDiffInnerClasses(htmlRow)
    } else {
      htmlRow.classList.remove('component-filtered')
    }
  })
}

// ---------------------------------------------------------------------------
// All-files highlighting
// ---------------------------------------------------------------------------

export function applyComponentHighlightingToAll(
  fileChanges: ReadonlyArray<WorkingDirectoryFileChange>,
  diffComponents: any[],
  selectedComponent: number | 'all' | 'misc',
  handleCharHighlightClick: (e: Event) => void
): void {
  if (selectedComponent === 'all') {
    // Restore all rows
    document.querySelectorAll('.folder-compare-view .row').forEach(row => {
      const htmlRow = row as HTMLElement
      htmlRow.classList.remove('component-filtered')
      htmlRow.classList.remove('component-hunk-start')
    })
    document.querySelectorAll('.folder-compare-view [data-original-top]').forEach(el => {
      const htmlEl = el as HTMLElement
      htmlEl.style.top = htmlEl.dataset.originalTop!
      // Restore height as well: CellMeasurer's ResizeObserver may have
      // recorded height=0 for rows that were hidden (visibility:hidden /
      // display:none), causing ReactVirtualized to overwrite inline heights.
      if (htmlEl.dataset.originalHeight !== undefined) {
        const savedH = parseInt(htmlEl.dataset.originalHeight, 10)
        if (savedH > 0) {
          htmlEl.style.height = `${savedH}px`
        }
      }
      htmlEl.classList.remove('component-hidden')
      htmlEl.classList.remove('component-packed')
      // Clear both saved attributes so the next component switch re-records
      // the correct pristine values on its first repack pass
      delete htmlEl.dataset.originalTop
      delete htmlEl.dataset.originalHeight
    })
    // Re-measure and set clip-wrapper heights from the now-restored row
    // positions.  We intentionally do NOT clear height/overflow here because
    // clearing height (even momentarily) lets diff-size-wrapper expand the
    // container to 100000px, which triggers a ReactVirtualized grid resize
    // that renders zero rows for one or more frames — causing a blank flash.
    // Instead we compute the correct height immediately (same formula as
    // shrinkWrappersToFit) so the clip-wrapper stays consistent throughout.
    // The caller's startShrinkPolling() will then refine the value as
    // ReactVirtualized lazily finishes measuring any remaining rows.
    document.querySelectorAll('.folder-compare-view .diff-clip-wrapper').forEach(clipEl => {
      const el = clipEl as HTMLElement
      const inner = el.querySelector(
        '.ReactVirtualized__Grid__innerScrollContainer'
      ) as HTMLElement
      if (!inner) return
      let contentHeight = 0
      Array.from(inner.children).forEach(child => {
        const row = child as HTMLElement
        const top = parseInt(row.style.top || '0', 10)
        const rawH = parseInt(row.style.height || '0', 10)
        const h = (top >= 0 && rawH <= 0) ? 20 : rawH
        if (top >= 0) contentHeight = Math.max(contentHeight, top + h)
      })
      if (contentHeight > 0) {
        el.style.height = `${contentHeight + 2}px`
        el.style.overflow = 'hidden'
      }
    })
    document.querySelectorAll('.folder-compare-view .component-hidden').forEach(el =>
      el.classList.remove('component-hidden')
    )
    document.querySelectorAll('.folder-compare-view .component-packed').forEach(el =>
      el.classList.remove('component-packed')
    )
    document.querySelectorAll(
      '.folder-compare-view .before, .folder-compare-view .after'
    ).forEach(side => {
      side.classList.remove('component-filtered-side')
      side.classList.remove('component-char-filtered')
    })
    // Restore cm-diff-delete-inner / cm-diff-add-inner classes stripped
    // during component highlighting (global cleanup path)
    document.querySelectorAll('.folder-compare-view [data-file-path]').forEach(fc =>
      restoreDiffInnerClasses(fc as HTMLElement)
    )
    document.querySelectorAll('.folder-compare-view .component-char-highlight').forEach(el =>
      el.remove()
    )
    document.querySelectorAll('.folder-compare-view .component-char-click-capture').forEach(el =>
      el.remove()
    )
    document.querySelectorAll('.folder-compare-view .component-char-white').forEach(el => {
      const parent = el.parentNode
      if (parent) {
        const text = document.createTextNode(el.textContent || '')
        parent.replaceChild(text, el)
        parent.normalize()
      }
    })
    document.querySelectorAll('.folder-compare-view .component-hunk-separator').forEach(el =>
      el.remove()
    )
    // Remove expanded context rows (source lines injected by expand handler)
    document.querySelectorAll('.folder-compare-view .expanded-context-row').forEach(el =>
      el.remove()
    )
    // Remove boundary expand buttons (re-injected after cleanup)
    document.querySelectorAll('.folder-compare-view .expand-boundary-bottom').forEach(el =>
      el.remove()
    )
    // Restore expand buttons on hunk-info rows that were previously expanded
    document.querySelectorAll('.folder-compare-view .hunk-expanded').forEach(el => {
      el.classList.remove('hunk-expanded')
      const htmlEl = el as HTMLElement
      if (htmlEl.dataset.originalTop !== undefined) {
        htmlEl.style.top = htmlEl.dataset.originalTop
      }
      const btn = el.querySelector('.expand-context-btn') as HTMLElement
      if (btn) btn.style.display = ''
    })
    document.querySelectorAll('.folder-compare-view [data-file-path]').forEach(el =>
      el.classList.remove('component-file-hidden')
    )
    return
  }

  for (const file of fileChanges) {
    applyComponentHighlightingForFile(
      file.path,
      diffComponents,
      selectedComponent,
      handleCharHighlightClick
    )
  }
}

// ---------------------------------------------------------------------------
// Inject expand buttons into "Show All" hunk-info rows
// ---------------------------------------------------------------------------

/**
 * Add an expand-context button to every original git `.hunk-info` row inside
 * the folder-compare view.  Called after diffs are rendered or after switching
 * back to "Show All".  Idempotent — skips rows that already have one.
 *
 * Clicking the expand button dispatches a `expand-hunk-context` CustomEvent on
 * the hunk-info row's outer wrapper.  The React view catches this event and
 * loads the missing source-file lines to fill the gap between hunks.
 */
export function injectExpandButtonsIntoHunkInfoRows(): void {
  document
    .querySelectorAll(
      '.folder-compare-view .hunk-info:not(.component-hunk-separator)'
    )
    .forEach(row => {
      // Skip if already injected
      if (row.querySelector('.expand-context-btn')) return

      const handle = row.querySelector('.hunk-expansion-handle')
      if (!handle) return

      // Check if this is the first hunk-info in its file container.
      // If the first content row after it starts at line 1 on both sides,
      // there is nothing before it to expand — hide the button.
      const outerWrapper = row.parentElement as HTMLElement
      if (outerWrapper) {
        const inner = outerWrapper.parentElement as HTMLElement
        if (inner) {
          const siblings = Array.from(inner.children) as HTMLElement[]
          const myIdx = siblings.indexOf(outerWrapper)
          // Check if this is the first hunk-info (no preceding hunk-info rows)
          const isFirstHunk = !siblings.slice(0, myIdx).some(sib => {
            const hi = sib.querySelector('.hunk-info:not(.component-hunk-separator)')
            return hi !== null
          })
          if (isFirstHunk) {
            // Look at the next sibling for line numbers
            const next = siblings[myIdx + 1]
            if (next) {
              const nextRow = (next.querySelector('.row') as HTMLElement) ?? next
              const beforeLabel = nextRow.querySelector('.before .line-number label')
              const afterLabel = nextRow.querySelector('.after .line-number label')
              const beforeLine = beforeLabel ? parseInt(beforeLabel.getAttribute('for')?.split('-')[0] || '0', 10) : 0
              const afterLine = afterLabel ? parseInt(afterLabel.getAttribute('for')?.split('-')[0] || '0', 10) : 0
              if (beforeLine <= 1 && afterLine <= 1) {
                // Nothing before line 1 — hide the expand button handle
                handle.innerHTML = ''
                return
              }
            }
          }
        }
      }

      const btn = document.createElement('button')
      btn.className = 'expand-context-btn'
      btn.title = 'Expand context'
      btn.appendChild(createExpandSvg())
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const hunkRow = (e.currentTarget as HTMLElement).closest('.hunk-info') as HTMLElement
        if (!hunkRow) return
        const outerWrapper = hunkRow.parentElement as HTMLElement
        if (!outerWrapper) return
        // Dispatch a custom event for the React view to handle
        outerWrapper.dispatchEvent(
          new CustomEvent('expand-hunk-context', { bubbles: true, detail: { outerWrapper } })
        )
      })

      // Clear existing placeholder content and insert our button
      handle.innerHTML = ''
      handle.appendChild(btn)

      // Replace the single React-rendered .content div with two .content
      // divs (before-side @@ and after-side @@) matching the structure of
      // component-hunk-separators and boundary expand buttons.
      const existingContent = row.querySelector('.content')
      if (existingContent) {
        existingContent.remove()

        const contentDiv = document.createElement('div')
        contentDiv.className = 'content'
        const prefix = document.createElement('div')
        prefix.className = 'prefix'
        prefix.innerHTML = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'
        const contentWrapper = document.createElement('div')
        contentWrapper.className = 'content-wrapper'
        contentWrapper.textContent = '@@'
        contentDiv.appendChild(prefix)
        contentDiv.appendChild(contentWrapper)

        const contentDiv2 = document.createElement('div')
        contentDiv2.className = 'content'
        contentDiv2.style.display = 'flex'
        const prefix2 = document.createElement('div')
        prefix2.className = 'prefix'
        prefix2.innerHTML = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'
        const contentWrapper2 = document.createElement('div')
        contentWrapper2.className = 'content-wrapper'
        contentWrapper2.textContent = '@@       '
        contentWrapper2.style.flex = '1'
        contentWrapper2.style.textAlign = 'right'
        contentDiv2.appendChild(prefix2)
        contentDiv2.appendChild(contentWrapper2)

        row.appendChild(contentDiv)
        row.appendChild(contentDiv2)
      }
    })
}

// ---------------------------------------------------------------------------
// Inject boundary expand buttons at the top/bottom of each file
// ---------------------------------------------------------------------------

/**
 * For each file's inner scroll container, add an expand button element at the
 * bottom (and re-use the first hunk-info for the top) so the user can expand
 * to the very beginning / end of the file.
 *
 * The bottom element dispatches a `expand-hunk-context` CustomEvent with
 * `isBottomBoundary: true`.  The top is already handled by the first
 * hunk-info (hunkIndex 0).
 *
 * Idempotent — skips files that already have the boundary element.
 */
export function injectBoundaryExpandButtons(
  beforeFolder?: string,
  afterFolder?: string
): void {
  document
    .querySelectorAll('.folder-compare-view [data-file-path]')
    .forEach(fileContainer => {
      const inner = fileContainer.querySelector(
        '.ReactVirtualized__Grid__innerScrollContainer'
      ) as HTMLElement
      if (!inner) return

      // Skip if already injected
      if (inner.querySelector('.expand-boundary-bottom')) return

      const filePath = (fileContainer as HTMLElement).dataset.filePath || ''

      // --- Check if last visible lines are already at the end of file ---
      // If so, there's nothing to expand — skip the bottom boundary entirely.
      if (beforeFolder && afterFolder && filePath) {
        // Find last visible line numbers in the DOM
        const children = Array.from(inner.children) as HTMLElement[]
        let lastBeforeLine = 0
        let lastAfterLine = 0
        for (let i = children.length - 1; i >= 0; i--) {
          const el = children[i]
          if (el.classList.contains('component-hunk-separator')) continue
          if (el.classList.contains('expanded-context-row')) continue
          if (parseInt(el.style.top || '0', 10) < -9999) continue
          if (el.classList.contains('component-hidden')) continue
          const row = (el.querySelector('.row') as HTMLElement) ?? el
          if (lastBeforeLine === 0) {
            const n = row.querySelector('.before .line-number')
            const v = n ? extractLineNumber(n) : null
            if (v !== null) lastBeforeLine = v
          }
          if (lastAfterLine === 0) {
            const n = row.querySelector('.after .line-number')
            const v = n ? extractLineNumber(n) : null
            if (v !== null) lastAfterLine = v
          }
          if (lastBeforeLine !== 0 && lastAfterLine !== 0) break
        }

        // Read total line counts from the source files
        let beforeTotal = 0
        let afterTotal = 0
        try {
          const content = fs.readFileSync(Path.join(beforeFolder, filePath), 'utf-8')
          beforeTotal = content.split('\n').length
        } catch { /* file may not exist for added files */ }
        try {
          const content = fs.readFileSync(Path.join(afterFolder, filePath), 'utf-8')
          afterTotal = content.split('\n').length
        } catch { /* file may not exist for deleted files */ }

        // If last visible lines reach the end of both files, skip
        const beforeAtEnd = beforeTotal === 0 || lastBeforeLine >= beforeTotal
        const afterAtEnd = afterTotal === 0 || lastAfterLine >= afterTotal
        if (beforeAtEnd && afterAtEnd) return
      }

      // Compute the current bottom position from siblings
      let bottomPosition = 0
      let sibRowHeight = 20
      Array.from(inner.children).forEach(child => {
        const row = child as HTMLElement
        // For component-packed rows, read the authoritative --packed-top
        // instead of inline style.top (which RV may have overwritten).
        let top: number
        if (row.classList.contains('component-packed')) {
          const packedTop = row.style.getPropertyValue('--packed-top')
          top = packedTop ? parseInt(packedTop, 10) : parseInt(row.style.top || '0', 10)
        } else {
          top = parseInt(row.style.top || '0', 10)
        }
        const h = parseInt(row.style.height || '0', 10)
        if (top >= 0 && h > 0) {
          bottomPosition = Math.max(bottomPosition, top + h)
          sibRowHeight = h
        }
      })

      // Sample the line-number gutter width from the nearest sibling row
      let gutterWidth = ''
      for (const sib of Array.from(inner.children) as HTMLElement[]) {
        const ln = sib.querySelector('.line-number') as HTMLElement
        if (ln && ln.style.width) { gutterWidth = ln.style.width; break }
      }

      // Create the bottom boundary element as a proper hunk-info row
      // matching the structure of the top hunk-info rows.
      const wrapper = document.createElement('div')
      wrapper.className = 'expand-boundary-bottom'
      wrapper.setAttribute('role', 'row')
      wrapper.style.position = 'absolute'
      wrapper.style.width = '100%'
      wrapper.style.height = `${sibRowHeight}px`
      wrapper.style.top = `${bottomPosition}px`
      wrapper.style.left = '0px'

      const hunkInfoRow = document.createElement('div')
      hunkInfoRow.className = 'hunk-info row'
      hunkInfoRow.setAttribute('role', 'cell')
      hunkInfoRow.style.height = '100%'

      // Expansion handle with button (left side)
      const expansionHandle = document.createElement('div')
      expansionHandle.className = 'hunk-expansion-handle'
      expansionHandle.style.width = gutterWidth || '35px'

      const btn = document.createElement('button')
      btn.className = 'expand-context-btn'
      btn.title = 'Expand to end of file'
      btn.appendChild(createExpandSvg())
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        wrapper.dispatchEvent(
          new CustomEvent('expand-hunk-context', {
            bubbles: true,
            detail: { outerWrapper: wrapper, isBottomBoundary: true },
          })
        )
      })
      expansionHandle.appendChild(btn)

      // Content div (before side) with @@
      const contentDiv = document.createElement('div')
      contentDiv.className = 'content'
      const prefix = document.createElement('div')
      prefix.className = 'prefix'
      prefix.innerHTML = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'
      const contentWrapper = document.createElement('div')
      contentWrapper.className = 'content-wrapper'
      contentWrapper.textContent = '@@'
      contentDiv.appendChild(prefix)
      contentDiv.appendChild(contentWrapper)

      // Content div (after side) with @@
      const contentDiv2 = document.createElement('div')
      contentDiv2.className = 'content'
      const prefix2 = document.createElement('div')
      prefix2.className = 'prefix'
      prefix2.innerHTML = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'
      const contentWrapper2 = document.createElement('div')
      contentWrapper2.className = 'content-wrapper'
      contentWrapper2.textContent = '@@'
      contentDiv2.appendChild(prefix2)
      contentDiv2.appendChild(contentWrapper2)

      hunkInfoRow.appendChild(expansionHandle)
      hunkInfoRow.appendChild(contentDiv)
      hunkInfoRow.appendChild(contentDiv2)
      wrapper.appendChild(hunkInfoRow)
      inner.appendChild(wrapper)

      // Grow inner container and Grid so the boundary element is not clipped
      // by ReactVirtualized's overflow.  Only grow, never shrink.
      const totalH = bottomPosition + sibRowHeight + 2
      const curInnerH = parseInt(inner.style.height || '0', 10)
      if (totalH > curInnerH) {
        inner.style.height = `${totalH}px`
      }
      const grid = inner.parentElement as HTMLElement | null
      if (grid) {
        const curGridH = parseInt(grid.style.height || '0', 10)
        if (totalH > curGridH) {
          grid.style.height = `${totalH}px`
        }
      }
      // Also grow the clip-wrapper so boundary is not visually clipped
      const clipWrapper = (fileContainer as HTMLElement).querySelector('.diff-clip-wrapper') as HTMLElement | null
      if (clipWrapper) {
        const curClipH = parseInt(clipWrapper.style.height || '0', 10)
        if (totalH > curClipH) {
          clipWrapper.style.height = `${totalH}px`
        }
      }
    })
}
