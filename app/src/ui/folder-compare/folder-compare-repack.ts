/**
 * DOM repacking helpers for the folder-compare view.
 *
 * Key design note — CellMeasurer safety:
 *
 * The Diff component uses ReactVirtualized with CellMeasurer.  CellMeasurer
 * attaches a ResizeObserver to every row.  If we ever set a row's *height* to
 * 0px to hide it, ResizeObserver fires, the cache is updated to height=0, and
 * ReactVirtualized re-renders with innerScrollContainer.height=0 — making the
 * whole grid go blank for every subsequent component switch.
 *
 * Fix: NEVER change a row's height.  Hidden rows are pushed far off-screen
 * with `top: -99999px` only.  Only the `diff-clip-wrapper` height is adjusted
 * for visual clipping; the inner container and Grid heights are left to
 * ReactVirtualized so it can continue to manage them correctly.
 */

// ---------------------------------------------------------------------------
// repackFile
// ---------------------------------------------------------------------------

/**
 * After `applyComponentHighlightingForFile` marks rows as `component-hidden`,
 * re-pack visible rows by reassigning their absolute `top` values.
 * Then clip the `diff-clip-wrapper` to the packed height.
 *
 * IMPORTANT: `diff-size-wrapper` and the ReactVirtualized Grid heights are
 * intentionally left unchanged — modifying them triggers a re-virtualization
 * that destroys rows for off-screen hunks.
 */
export function repackFile(fileContainer: Element): void {
  const inner = fileContainer.querySelector(
    '.ReactVirtualized__Grid__innerScrollContainer'
  ) as HTMLElement
  const clipWrapper = fileContainer.querySelector('.diff-clip-wrapper') as HTMLElement
  if (!inner) return

  let rowHeight = 20 // fallback
  const outerWrappers = Array.from(inner.children) as HTMLElement[]

  // ── Pass 1: restore any previously-saved pristine positions ──────────────
  // Undo any top:-99999px (or packed offsets) applied by a previous repack.
  // We do NOT delete the saved value here — it is authoritative for the lifetime
  // of the current diff load and must survive multiple component switches.
  // It is only cleared by applyComponentHighlightingToAll when 'all' is selected.
  outerWrappers.forEach(el => {
    if (el.classList.contains('component-hunk-separator')) return
    if (el.classList.contains('expanded-context-row')) return
    if (el.classList.contains('expand-boundary-bottom')) return
    el.classList.remove('component-packed')
    if (el.dataset.originalTop !== undefined) {
      el.style.top = el.dataset.originalTop
    }
  })

  // ── Pass 2: lazily record pristine positions and row height ───────────────
  // Only write data-original-top / data-original-height the very first time we
  // see each element (i.e. when the attribute is absent).  This prevents a
  // second repack call (triggered by the MutationObserver seeing separator
  // insertions) from overwriting the saved baseline with an already-packed
  // value, which was the root cause of blank diffs after the first component
  // switch.
  outerWrappers.forEach(el => {
    if (el.classList.contains('component-hunk-separator')) return
    if (el.classList.contains('expanded-context-row')) return
    if (el.classList.contains('expand-boundary-bottom')) return
    const h = parseInt(el.style.height || '0', 10)
    if (h > 0) rowHeight = h
    if (el.dataset.originalTop === undefined) {
      el.dataset.originalTop = el.style.top
      el.dataset.originalHeight = String(h)
    }
  })

  // ── Pass 3: pack visible rows; push hidden rows far off-screen ─────────────
  // We NEVER change row heights — CellMeasurer's ResizeObserver watches them
  // and would poison its height cache if they were set to 0.
  let accTop = 0
  outerWrappers.forEach(el => {
    if (el.classList.contains('component-hunk-separator')) {
      el.style.top = `${accTop}px`
      el.style.height = `${rowHeight}px`
      accTop += rowHeight
    } else if (el.classList.contains('expanded-context-row')) {
      // Expanded context rows have a fixed height set when created
      const h = parseInt(el.style.height || String(rowHeight), 10)
      el.style.top = `${accTop}px`
      accTop += h > 0 ? h : rowHeight
    } else if (el.classList.contains('expand-boundary-bottom')) {
      // Bottom boundary expand button — position at the end
      el.style.top = `${accTop}px`
      el.style.height = `${rowHeight}px`
      accTop += rowHeight
    } else if (el.classList.contains('component-hidden') || el.classList.contains('hunk-expanded')) {
      el.style.top = '-99999px' // off-screen — height untouched
    } else {
      el.style.top = `${accTop}px`
      el.classList.add('component-packed')
      el.style.setProperty('--packed-top', `${accTop}px`)
      const h = parseInt(el.dataset.originalHeight || String(rowHeight), 10)
      const effectiveH = h > 0 ? h : rowHeight
      // If ReactVirtualized left this row at height:0 (an unrendered placeholder),
      // explicitly restore the height so the content is not clipped.
      // Setting 0→N is safe for CellMeasurer — it records the correct height.
      if (parseInt(el.style.height || '0', 10) === 0 && effectiveH > 0) {
        el.style.height = `${effectiveH}px`
      }
      accTop += effectiveH
    }
  })

  // Grow the inner scroll container so expanded rows are not clipped.
  // ReactVirtualized sets this to its own measured total; we only grow,
  // never shrink, to avoid interfering with its bookkeeping.
  if (accTop > 0 && inner) {
    const curH = parseInt(inner.style.height || '0', 10)
    if (accTop > curH) {
      inner.style.height = `${accTop}px`
    }
    // Also grow the Grid element (parent of inner) if needed.
    const grid = inner.parentElement as HTMLElement | null
    if (grid) {
      const gridH = parseInt(grid.style.height || '0', 10)
      if (accTop > gridH) {
        grid.style.height = `${accTop}px`
      }
    }
  }

  // Clip the visible area via diff-clip-wrapper only.
  if (accTop > 0 && clipWrapper) {
    clipWrapper.style.height = `${accTop}px`
    clipWrapper.style.overflow = 'hidden'
  }
}

// ---------------------------------------------------------------------------
// expandHunkAtElement
// ---------------------------------------------------------------------------

/**
 * Expand hidden context rows around a hunk separator or hunk-info row.
 *
 * When the user clicks the expand button on a separator, we reveal every
 * `component-hidden` row between the clicked separator and its neighbours
 * (previous separator above, next separator below — or the edges of the
 * container).  The separator itself is then removed and the file is
 * re-packed so the layout is consistent.
 *
 * For "Show All" hunk-info rows (which are *not* `component-hunk-separator`
 * elements but rather the original git diff hunk headers), we expand by
 * revealing any `component-hidden` rows adjacent to the hunk-info row.
 * Since "Show All" does not hide rows, this is effectively a no-op there
 * unless a component/misc view was previously active.  The main use case
 * for "Show All" expand is when the diff itself has collapsed context
 * (e.g. only 3 context lines between hunks) and the user wants to see the
 * full file.  For those we simply mark the hunk-info row itself as expanded
 * (hiding it and revealing all hidden neighbours).
 */
export function expandHunkAtElement(clickedEl: HTMLElement): void {
  // Walk up to the innerScrollContainer
  const inner = clickedEl.closest(
    '.ReactVirtualized__Grid__innerScrollContainer'
  ) as HTMLElement
  if (!inner) return

  const fileContainer = inner.closest('[data-file-path]') as HTMLElement
  if (!fileContainer) return

  const children = Array.from(inner.children) as HTMLElement[]
  const clickedIdx = children.indexOf(clickedEl)
  if (clickedIdx === -1) return

  // Determine the range of children to un-hide.
  // Walk backwards to find the previous separator (or start)
  let startIdx = clickedIdx
  for (let i = clickedIdx - 1; i >= 0; i--) {
    const el = children[i]
    if (
      el.classList.contains('component-hunk-separator') ||
      (el.querySelector('.row.hunk-info') !== null && el !== clickedEl) ||
      (el.classList.contains('hunk-info') && el !== clickedEl)
    ) {
      break
    }
    startIdx = i
  }

  // Walk forward to find the next separator (or end)
  let endIdx = clickedIdx
  for (let i = clickedIdx + 1; i < children.length; i++) {
    const el = children[i]
    if (
      el.classList.contains('component-hunk-separator') ||
      (el.querySelector('.row.hunk-info') !== null && el !== clickedEl) ||
      (el.classList.contains('hunk-info') && el !== clickedEl)
    ) {
      break
    }
    endIdx = i
  }

  // Reveal all hidden rows in [startIdx, endIdx]
  for (let i = startIdx; i <= endIdx; i++) {
    const el = children[i]
    if (el === clickedEl) continue
    el.classList.remove('component-hidden')
    // Also reveal nested rows (the outer wrapper wraps a .row child)
    el.querySelectorAll('.component-hidden').forEach(child => {
      child.classList.remove('component-hidden')
    })
  }

  // Remove the separator itself (if it's a component-hunk-separator)
  if (clickedEl.classList.contains('component-hunk-separator')) {
    clickedEl.remove()
  } else {
    // For "Show All" hunk-info rows, just hide the expand button to indicate expanded
    clickedEl.classList.add('hunk-expanded')
    const btn = clickedEl.querySelector('.expand-context-btn') as HTMLElement
    if (btn) btn.style.display = 'none'
  }

  // Re-pack to fix absolute positions
  repackFile(fileContainer)
}

// ---------------------------------------------------------------------------
// shrinkWrappersToFit
// ---------------------------------------------------------------------------

/**
 * After all diffs have rendered (with diff-size-wrapper at height:100000px),
 * measure the actual content height and clip `diff-clip-wrapper` to that height
 * for a clean visual appearance.
 *
 * Only the clip-wrapper height is changed.  Inner container and Grid heights
 * are left entirely to ReactVirtualized to avoid corrupting CellMeasurer cache.
 *
 * Called once after the initial load and again when restoring to "Show All".
 */
export function shrinkWrappersToFit(): void {
  document.querySelectorAll('.folder-compare-view .diff-clip-wrapper').forEach(clipWrapper => {
    const el = clipWrapper as HTMLElement
    const inner = el.querySelector(
      '.ReactVirtualized__Grid__innerScrollContainer'
    ) as HTMLElement

    if (!inner) return

    // Compute height as max(top + height) across all child wrappers.
    // We CANNOT use inner.scrollHeight here: ReactVirtualized keeps many rows
    // at height:0px (CellMeasurer placeholders not yet measured), so those
    // contribute 0 to scrollHeight even though they occupy vertical space in
    // the layout.  Instead we look at each row's absolute top + height and
    // take the maximum, which is the true bottom edge of the content.
    //
    // For rows with the `component-packed` class, we read the authoritative
    // `--packed-top` CSS custom property instead of the inline `style.top`.
    // ReactVirtualized's ResizeObserver may overwrite the inline top after
    // repackFile runs, but the CSS custom property is never touched by RV.
    let contentHeight = 0
    Array.from(inner.children).forEach(child => {
      const row = child as HTMLElement

      // Determine the authoritative top position
      let top: number
      if (row.classList.contains('component-packed')) {
        const packedTop = row.style.getPropertyValue('--packed-top')
        top = packedTop ? parseInt(packedTop, 10) : parseInt(row.style.top || '0', 10)
      } else {
        top = parseInt(row.style.top || '0', 10)
      }

      // Use a 20px fallback for rows that haven't been measured yet
      const rawH = parseInt(row.style.height || '0', 10)
      const h = (top >= 0 && rawH <= 0) ? 20 : rawH

      // Skip rows that were pushed off-screen by repackFile (top = -99999px)
      if (top >= 0) {
        contentHeight = Math.max(contentHeight, top + h)
      }
    })

    if (contentHeight <= 0) return // nothing to clip yet

    contentHeight += 2 // small buffer for border / subpixel rounding

    // Clip the outer wrapper.
    el.style.height = `${contentHeight}px`
    el.style.overflow = 'hidden'

    // Also grow the inner container and Grid so boundary expand buttons
    // (which are not managed by ReactVirtualized) are not clipped by the
    // inner container's overflow.  Only grow, never shrink, to avoid
    // interfering with RV's bookkeeping.
    const curInnerH = parseInt(inner.style.height || '0', 10)
    if (contentHeight > curInnerH) {
      inner.style.height = `${contentHeight}px`
    }
    const grid = inner.parentElement as HTMLElement | null
    if (grid) {
      const curGridH = parseInt(grid.style.height || '0', 10)
      if (contentHeight > curGridH) {
        grid.style.height = `${contentHeight}px`
      }
    }
  })
}

// ---------------------------------------------------------------------------
// setupScrollSync
// ---------------------------------------------------------------------------

/**
 * Add a sticky horizontal scrollbar per side (before/after) at the bottom of
 * each file's diff container.  All `.content` elements on the same side scroll
 * together via `translateX` so every line moves by the same amount.
 */
export function setupScrollSync(): void {
  document.querySelectorAll('.folder-compare-view [data-file-path]').forEach(fileContainer => {
    const diffContainer = fileContainer.querySelector('.diff-container') as HTMLElement
    if (!diffContainer) return
    if (diffContainer.querySelector('.scroll-sync-bar')) return // already set up

    const beforeContents = Array.from(
      fileContainer.querySelectorAll('.before .content')
    ) as HTMLElement[]
    const afterContents = Array.from(
      fileContainer.querySelectorAll('.after .content')
    ) as HTMLElement[]
    if (beforeContents.length === 0 && afterContents.length === 0) return

    const maxBeforeSW = Math.max(0, ...beforeContents.map(el => el.scrollWidth))
    const maxAfterSW = Math.max(0, ...afterContents.map(el => el.scrollWidth))

    const firstBefore = beforeContents[0]
    const firstAfter = afterContents[0]
    const beforeOverflows = firstBefore && maxBeforeSW > firstBefore.clientWidth + 2
    const afterOverflows = firstAfter && maxAfterSW > firstAfter.clientWidth + 2
    if (!beforeOverflows && !afterOverflows) return

    const syncBar = document.createElement('div')
    syncBar.className = 'scroll-sync-bar'

    const beforeBar = document.createElement('div')
    beforeBar.style.width = '50%'
    const beforeInner = document.createElement('div')
    beforeInner.style.height = '1px'
    beforeBar.appendChild(beforeInner)

    const afterBar = document.createElement('div')
    afterBar.style.width = '50%'
    const afterInner = document.createElement('div')
    afterInner.style.height = '1px'
    afterBar.appendChild(afterInner)

    syncBar.appendChild(beforeBar)
    syncBar.appendChild(afterBar)
    diffContainer.appendChild(syncBar)

    requestAnimationFrame(() => {
      const maxSW = Math.max(maxBeforeSW, maxAfterSW)
      beforeInner.style.width = `${maxSW}px`
      afterInner.style.width = `${maxSW}px`
    })

    beforeBar.addEventListener('scroll', () => {
      const sl = beforeBar.scrollLeft
      // Use a live query so dynamically-inserted expanded-context-rows are included
      const liveContents = Array.from(
        fileContainer.querySelectorAll('.before .content')
      ) as HTMLElement[]
      liveContents.forEach(el => {
        const w = el.querySelector('.content-wrapper') as HTMLElement
        if (w) w.style.transform = `translateX(-${sl}px)`
      })
    })

    afterBar.addEventListener('scroll', () => {
      const sl = afterBar.scrollLeft
      const liveContents = Array.from(
        fileContainer.querySelectorAll('.after .content')
      ) as HTMLElement[]
      liveContents.forEach(el => {
        const w = el.querySelector('.content-wrapper') as HTMLElement
        if (w) w.style.transform = `translateX(-${sl}px)`
      })
    })
  })
}
