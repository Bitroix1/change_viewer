/**
 * DOM highlighting helpers for the folder-compare view.
 *
 * All functions are pure wrt React state — they only touch the DOM.
 * Callers pass the necessary state slices as arguments.
 */

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
  selectedComponent: number | 'all',
  filePath: string
): LineHighlight[] {
  if (selectedComponent === 'all') return []
  const component = diffComponents[selectedComponent as number]
  if (!component || !component.changes) return []

  const pathMatches = (jsonFile: string, fullPath: string): boolean =>
    fullPath === jsonFile ||
    fullPath.endsWith('/' + jsonFile) ||
    fullPath.endsWith('\\' + jsonFile)

  const lineMap = new Map<string, LineHighlight>()

  for (const change of component.changes) {
    const side: HighlightSide = change.kind === 'Removal' ? 'before' : 'after'
    if (change.from && pathMatches(change.from.file, filePath) && change.from.position) {
      addPositionToLineMap(lineMap, change.from.position, side)
    }
    if (change.to && pathMatches(change.to.file, filePath) && change.to.position) {
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
}

// ---------------------------------------------------------------------------
// Per-file highlighting
// ---------------------------------------------------------------------------

export function applyComponentHighlightingForFile(
  filePath: string,
  diffComponents: any[],
  selectedComponent: number | 'all',
  handleCharHighlightClick: (e: Event) => void
): void {
  const fileContainer = document.querySelector(
    `.folder-compare-view [data-file-path="${filePath}"]`
  )
  if (!fileContainer) return

  // --- cleanup previous state ---
  fileContainer.querySelectorAll('.component-char-highlight').forEach(el => el.remove())
  fileContainer.querySelectorAll('.component-char-click-capture').forEach(el => el.remove())
  fileContainer.querySelectorAll('.component-hunk-separator').forEach(el => el.remove())
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
      const separator = document.createElement('div')
      separator.className = 'component-hunk-separator hunk-info row'
      separator.setAttribute('role', 'cell')
      const expansionHandle = document.createElement('div')
      expansionHandle.className = 'hunk-expansion-handle'
      expansionHandle.style.width = '35px'
      const placeholder = document.createElement('div')
      placeholder.className = 'hunk-expansion-placeholder'
      expansionHandle.appendChild(placeholder)
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
      } else {
        beforeSide.classList.add('component-filtered-side')
        beforeSide.classList.remove('component-char-filtered')
      }
    }

    if (afterSide) {
      if (afterRangesForLine && afterRangesForLine.length > 0) {
        afterSide.classList.remove('component-filtered-side')
        afterSide.classList.add('component-char-filtered')
        const cw = afterSide.querySelector('.content-wrapper') as HTMLElement
        if (cw) addCharHighlights(cw, afterRangesForLine, 'after', handleCharHighlightClick)
      } else {
        afterSide.classList.add('component-filtered-side')
        afterSide.classList.remove('component-char-filtered')
      }
    }

    if (!beforeRangesForLine && !afterRangesForLine) {
      htmlRow.classList.add('component-filtered')
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
  selectedComponent: number | 'all',
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
        const h = parseInt(row.style.height || '0', 10)
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
    document.querySelectorAll('.folder-compare-view .component-char-highlight').forEach(el =>
      el.remove()
    )
    document.querySelectorAll('.folder-compare-view .component-char-click-capture').forEach(el =>
      el.remove()
    )
    document.querySelectorAll('.folder-compare-view .component-hunk-separator').forEach(el =>
      el.remove()
    )
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
