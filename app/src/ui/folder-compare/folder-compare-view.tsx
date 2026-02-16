import * as React from 'react'
import * as Path from 'path'
import * as FSPromises from 'fs/promises'
import { Button } from '../lib/button'
import { Dispatcher } from '../dispatcher'
import { FolderSelector } from './folder-selector'
import { WorkingDirectoryFileChange } from '../../models/status'
import { AppFileStatusKind } from '../../models/status'
import { DiffSelection, DiffSelectionType } from '../../models/diff'
import { ITextDiff, ImageDiffType } from '../../models/diff'
import { computeDiff } from './diff-generator'
import { Diff } from '../diff'
import { Repository } from '../../models/repository'

interface IFolderCompareViewProps {
  readonly dispatcher: Dispatcher
}

interface IFolderCompareViewState {
  readonly showFolderSelector: boolean
  readonly beforeFolder: string
  readonly afterFolder: string
  readonly fileChanges: ReadonlyArray<WorkingDirectoryFileChange>
  readonly fileDiffs: Map<string, ITextDiff | null>
  readonly isLoading: boolean
  readonly isLoadingDiffs: boolean
  readonly diffComponents: any[]
  readonly selectedComponent: number | 'all'
}

export class FolderCompareView extends React.Component<
  IFolderCompareViewProps,
  IFolderCompareViewState
> {
  public constructor(props: IFolderCompareViewProps) {
    super(props)
    this.state = {
      showFolderSelector: true,
      beforeFolder: '',
      afterFolder: '',
      fileChanges: [],
      fileDiffs: new Map(),
      isLoading: false,
      isLoadingDiffs: false,
      diffComponents: [],
      selectedComponent: 'all',
    }
  }

  public render() {
    if (this.state.showFolderSelector) {
      return (
        <FolderSelector
          beforeFolder={this.state.beforeFolder}
          afterFolder={this.state.afterFolder}
          onDismissed={this.onFolderSelectorDismissed}
          onCompareFolders={this.onCompareFolders}
        />
      )
    }

    return (
      <div className="folder-compare-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', height: '100%' }}>
          {/* Left Sidebar for Component Selection */}
          {this.state.diffComponents.length > 0 && (
            <div className="component-selector-sidebar" style={{
              width: '200px',
              borderRight: '1px solid var(--box-border-color)',
              backgroundColor: 'var(--box-alt-background-color)',
              padding: '15px',
              overflow: 'auto'
            }}>
              <h3 style={{ margin: '0 0 15px 0', fontSize: '14px', fontWeight: 600 }}>View Options</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px',
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '4px',
                  backgroundColor: this.state.selectedComponent === 'all' ? 'var(--background-color)' : 'transparent'
                }}>
                  <input
                    type="radio"
                    name="component-view"
                    value="all"
                    checked={this.state.selectedComponent === 'all'}
                    onChange={this.onComponentChange}
                  />
                  <span style={{ fontSize: '13px' }}>Show All</span>
                </label>
                {this.state.diffComponents.map((_, index) => (
                  <label
                    key={index}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '8px',
                      borderRadius: '4px',
                      backgroundColor: this.state.selectedComponent === index ? 'var(--background-color)' : 'transparent'
                    }}
                  >
                    <input
                      type="radio"
                      name="component-view"
                      value={index}
                      checked={this.state.selectedComponent === index}
                      onChange={this.onComponentChange}
                    />
                    <span style={{ fontSize: '13px' }}>Component {index + 1}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div className="folder-compare-header" style={{ padding: '10px', borderBottom: '1px solid var(--box-border-color)', backgroundColor: 'var(--box-background-color)' }}>
              <h2 style={{ margin: '0 0 10px 0' }}>Folder Comparison</h2>
              <div className="folder-paths" style={{ fontSize: '12px', marginBottom: '10px' }}>
                <div><strong>Before:</strong> {this.state.beforeFolder}</div>
                <div><strong>After:</strong> {this.state.afterFolder}</div>
              </div>
              <Button onClick={this.onChangeFolders}>Change Folders</Button>
            </div>
        
            {this.state.isLoading && <div style={{ padding: '20px' }}>Loading files...</div>}
            
            {this.state.isLoadingDiffs && <div style={{ padding: '20px' }}>Loading diffs...</div>}
            
            {!this.state.isLoading && this.state.fileChanges.length === 0 && (
              <div style={{ padding: '20px' }}>No differences found</div>
            )}
            
            {!this.state.isLoading && this.state.fileChanges.length > 0 && (
              <div className="folder-compare-content" style={{ 
                flex: 1, 
                overflow: 'auto',
                minHeight: 0,
                padding: '20px'
              }}>
            <div>
              <div className="file-list-header" style={{ 
                padding: '10px 20px',
                backgroundColor: 'var(--box-alt-background-color)',
                borderBottom: '1px solid var(--box-border-color)',
                borderTopLeftRadius: '6px',
                borderTopRightRadius: '6px',
                position: 'sticky',
                top: '0',
                zIndex: 10,
                marginBottom: '20px'
              }}>
                {this.state.fileChanges.length} changed {this.state.fileChanges.length === 1 ? 'file' : 'files'}
              </div>
              
              {this.state.fileChanges.map((file, index) => (
                <div key={file.id} data-file-path={file.path} style={{ 
                  border: '1px solid var(--box-border-color)',
                  borderRadius: '6px',
                  marginTop: index === 0 ? 0 : '20px',
                  marginBottom: index === this.state.fileChanges.length - 1 ? '0' : '0',
                  overflow: 'hidden',
                  backgroundColor: 'var(--box-background-color)'
                }}>
                  <div style={{ 
                    padding: '15px 20px', 
                    backgroundColor: 'var(--box-alt-background-color)',
                    borderBottom: '1px solid var(--box-border-color)'
                  }}>
                    <h3 style={{ margin: '0 0 5px 0', fontSize: '14px', fontWeight: 600 }}>
                      {file.path}
                    </h3>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary-color)' }}>
                      {this.getStatusLabel(file.status.kind)}
                    </div>
                  </div>
                  
                  <div className="diff-container" style={{ 
                    backgroundColor: 'var(--background-color)',
                    display: 'flex',
                    flexDirection: 'column'
                  }}>
                    {this.renderDiffForFile(file)}
                  </div>
                </div>
              ))}
            </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  private getDummyRepository(): Repository {
    // Create a minimal dummy repository object for the Diff component
    // It doesn't need to be functional, just satisfy the type requirements
    return {
      id: 0,
      path: this.state.beforeFolder || '',
      name: 'Folder Comparison',
      missing: false,
      hash: 'folder-compare-temp',
    } as Repository
  }

  private renderDiffForFile(file: WorkingDirectoryFileChange): JSX.Element {
    const diff = this.state.fileDiffs.get(file.id)
    
    if (diff === undefined) {
      return (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary-color)' }}>
          Loading diff...
        </div>
      )
    }
    
    if (diff === null) {
      return (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary-color)' }}>
          Unable to load diff
        </div>
      )
    }
    
    // Calculate height to exactly fit content:
    // 75px for diff header + (rows × 20px) for grid content
    const lineCount = diff.hunks.reduce((total, hunk) => total + hunk.lines.length, 0)
    const hunkCount = diff.hunks.length
    const totalRows = lineCount + hunkCount  // Each hunk header is also a row
    const calculatedHeight = 75 + (totalRows * 20)
    
    return (
      <div style={{ height: `${calculatedHeight}px`, display: 'flex', flexDirection: 'column' }}>
        <Diff
          repository={this.getDummyRepository()}
          readOnly={true}
          file={file}
          diff={diff}
          fileContents={null}
          imageDiffType={ImageDiffType.TwoUp}
          hideWhitespaceInDiff={false}
          showSideBySideDiff={true}
          showDiffCheckMarks={false}
          onOpenBinaryFile={() => {}}
          onChangeImageDiffType={() => {}}
          onHideWhitespaceInDiffChanged={() => {}}
        />
        <style>{`
          /* === Fully filtered rows/sides (not in component at all) === */
          .folder-compare-view .component-filtered,
          .folder-compare-view .component-filtered.modified,
          .folder-compare-view .component-filtered.added,
          .folder-compare-view .component-filtered.deleted {
            background-color: var(--background-color) !important;
          }
          
          .folder-compare-view .component-filtered .before,
          .folder-compare-view .component-filtered .after,
          .folder-compare-view .component-filtered-side {
            background-color: var(--background-color) !important;
          }
          
          .folder-compare-view .component-filtered .line-number,
          .folder-compare-view .component-filtered .line-number label,
          .folder-compare-view .component-filtered .line-number span,
          .folder-compare-view .component-filtered-side .line-number,
          .folder-compare-view .component-filtered-side .line-number label,
          .folder-compare-view .component-filtered-side .line-number span {
            background-color: var(--diff-gutter-background-color) !important;
          }
          
          .folder-compare-view .component-filtered .line-number.line-selected,
          .folder-compare-view .component-filtered-side .line-number.line-selected {
            background-color: var(--diff-gutter-background-color) !important;
          }
          
          .folder-compare-view .component-filtered .content,
          .folder-compare-view .component-filtered .content-wrapper,
          .folder-compare-view .component-filtered-side .content,
          .folder-compare-view .component-filtered-side .content-wrapper {
            background-color: var(--background-color) !important;
          }
          
          .folder-compare-view .component-filtered .cm-diff-delete,
          .folder-compare-view .component-filtered .cm-diff-add,
          .folder-compare-view .component-filtered .cm-diff-delete-bg,
          .folder-compare-view .component-filtered .cm-diff-add-bg,
          .folder-compare-view .component-filtered span[class*="cm-diff"],
          .folder-compare-view .component-filtered-side .cm-diff-delete,
          .folder-compare-view .component-filtered-side .cm-diff-add,
          .folder-compare-view .component-filtered-side .cm-diff-delete-bg,
          .folder-compare-view .component-filtered-side .cm-diff-add-bg,
          .folder-compare-view .component-filtered-side span[class*="cm-diff"] {
            background-color: transparent !important;
          }
          
          .folder-compare-view .component-filtered .diff-line-gutter,
          .folder-compare-view .component-filtered-side .diff-line-gutter {
            background-color: transparent !important;
          }
          


          /* Make dividers gray by default, then blue only for changed rows */
          .folder-compare-view .hunk-handle-place-holder,
          .folder-compare-view .hunk-handle-place-holder.selected {
            background-color: var(--diff-empty-hunk-handle) !important;
          }
          .folder-compare-view .row.added .hunk-handle-place-holder,
          .folder-compare-view .row.deleted .hunk-handle-place-holder,
          .folder-compare-view .row.modified .hunk-handle-place-holder {
            background-color: var(--diff-selected-border-color) !important;
          }
          .folder-compare-view .component-filtered .hunk-handle-place-holder {
            background-color: var(--diff-empty-hunk-handle) !important;
          }

          /* === Character-level filtered sides (line is in component but only specific chars highlighted) === */
          /* Only clear the inner cm-diff character highlights so our overlays show through.
             Keep the line-level background (on side / .content / .content-wrapper) intact.
             Line numbers keep their original diff coloring (blue/green/red). */
          .folder-compare-view .component-char-filtered .cm-diff-delete,
          .folder-compare-view .component-char-filtered .cm-diff-add,
          .folder-compare-view .component-char-filtered .cm-diff-delete-bg,
          .folder-compare-view .component-char-filtered .cm-diff-add-bg,
          .folder-compare-view .component-char-filtered span[class*="cm-diff"] {
            background-color: transparent !important;
          }

          /* Character-level highlight overlays */
          .folder-compare-view .component-char-highlight {
            position: absolute;
            top: 20%;
            bottom: 20%;
            pointer-events: none;
            z-index: 0;
          }
          .folder-compare-view .component-highlight-add {
            background-color: var(--diff-add-inner-background-color);
          }
          .folder-compare-view .component-highlight-delete {
            background-color: var(--diff-delete-inner-background-color);
          }

          /* Ensure text content renders on top of highlight overlays (exclude the overlays themselves) */
          .folder-compare-view .component-char-filtered .content-wrapper > *:not(.component-char-highlight) {
            position: relative;
            z-index: 1;
          }
        `}</style>
      </div>
    )
  }

  private mutationObserver: MutationObserver | null = null
  private isApplyingHighlighting = false
  private highlightingRAF: number | null = null

  public componentDidUpdate(prevProps: IFolderCompareViewProps, prevState: IFolderCompareViewState): void {
    // Apply highlighting when component selection changes
    if (prevState.selectedComponent !== this.state.selectedComponent) {
      // Use setTimeout to ensure DOM has been updated
      setTimeout(() => this.applyComponentHighlightingToAll(), 0)
    }

    // Set up MutationObserver when diff content first appears
    if (!this.mutationObserver && !this.state.showFolderSelector && this.state.fileChanges.length > 0 && !this.state.isLoadingDiffs) {
      this.setupMutationObserver()
    }
  }

  public componentWillUnmount(): void {
    this.cleanupMutationObserver()
  }

  private setupMutationObserver(): void {
    this.cleanupMutationObserver()

    this.mutationObserver = new MutationObserver(() => {
      if (this.isApplyingHighlighting) return
      if (this.state.selectedComponent === 'all') return

      // Debounce via requestAnimationFrame to batch scroll-triggered DOM changes
      if (this.highlightingRAF) {
        cancelAnimationFrame(this.highlightingRAF)
      }
      this.highlightingRAF = requestAnimationFrame(() => {
        this.applyComponentHighlightingToAll()
      })
    })

    const container = document.querySelector('.folder-compare-view')
    if (container) {
      this.mutationObserver.observe(container, {
        childList: true,
        subtree: true,
      })
    }
  }

  private cleanupMutationObserver(): void {
    if (this.highlightingRAF) {
      cancelAnimationFrame(this.highlightingRAF)
      this.highlightingRAF = null
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
      this.mutationObserver = null
    }
  }

  private applyComponentHighlightingToAll(): void {
    this.isApplyingHighlighting = true

    if (this.state.selectedComponent === 'all') {
      // Remove all filtering across all files
      document.querySelectorAll('.folder-compare-view .row').forEach(row => {
        row.classList.remove('component-filtered')
      })
      document.querySelectorAll('.folder-compare-view .before, .folder-compare-view .after').forEach(side => {
        side.classList.remove('component-filtered-side')
        side.classList.remove('component-char-filtered')
      })
      document.querySelectorAll('.folder-compare-view .component-char-highlight').forEach(el => el.remove())
      this.isApplyingHighlighting = false
      return
    }

    // Apply highlighting scoped to each file's container
    for (const file of this.state.fileChanges) {
      this.applyComponentHighlightingForFile(file.path)
    }

    this.isApplyingHighlighting = false
  }

  /**
   * Extract the actual source file line number from a .line-number element.
   * The label's `for` attribute has format "{lineNumber}-before" or "{lineNumber}-after".
   */
  private extractLineNumber(lineNumberDiv: Element): number | null {
    const label = lineNumberDiv.querySelector('label')
    if (!label) return null

    const htmlFor = label.getAttribute('for')
    if (!htmlFor) return null

    const match = htmlFor.match(/^(\d+)-(before|after)$/)
    return match ? parseInt(match[1], 10) : null
  }

  private applyComponentHighlightingForFile(filePath: string): void {
    // Scope to this specific file's container using data-file-path
    const fileContainer = document.querySelector(`.folder-compare-view [data-file-path="${filePath}"]`)
    if (!fileContainer) return

    // Clean up previous character highlights for this file
    fileContainer.querySelectorAll('.component-char-highlight').forEach(el => el.remove())
    fileContainer.querySelectorAll('.component-char-filtered').forEach(el => {
      el.classList.remove('component-char-filtered')
    })

    const highlights = this.getHighlightedLinesForComponent(filePath)

    // Find all diff rows within this file's container
    const diffRows = fileContainer.querySelectorAll('.row')

    // Build lookup maps: line number → column ranges for before/after sides
    const beforeHighlights = new Map<number, Array<{startCol: number, endCol: number}>>()
    const afterHighlights = new Map<number, Array<{startCol: number, endCol: number}>>()

    for (const h of highlights) {
      const map = h.side === 'before' ? beforeHighlights : afterHighlights
      const existing = map.get(h.line)
      if (existing) {
        existing.push(...h.ranges)
      } else {
        map.set(h.line, [...h.ranges])
      }
    }

    if (highlights.length === 0) {
      // No highlights for this file - filter all changed rows
      diffRows.forEach(row => {
        const htmlRow = row as HTMLElement
        if (htmlRow.classList.contains('added') ||
            htmlRow.classList.contains('deleted') ||
            htmlRow.classList.contains('modified')) {
          htmlRow.classList.add('component-filtered')
          const beforeSide = htmlRow.querySelector('.before') as HTMLElement
          const afterSide = htmlRow.querySelector('.after') as HTMLElement
          if (beforeSide) beforeSide.classList.add('component-filtered-side')
          if (afterSide) afterSide.classList.add('component-filtered-side')
        }
      })
      return
    }

    diffRows.forEach(row => {
      const htmlRow = row as HTMLElement

      // Skip context and hunk-info rows
      if (!htmlRow.classList.contains('modified') &&
          !htmlRow.classList.contains('added') &&
          !htmlRow.classList.contains('deleted')) {
        return
      }

      let beforeRanges: Array<{startCol: number, endCol: number}> | undefined
      let afterRanges: Array<{startCol: number, endCol: number}> | undefined

      // Check before (left) side
      const beforeLineNumDiv = htmlRow.querySelector('.before .line-number')
      if (beforeLineNumDiv) {
        const lineNumber = this.extractLineNumber(beforeLineNumDiv)
        if (lineNumber !== null) {
          beforeRanges = beforeHighlights.get(lineNumber)
        }
      }

      // Check after (right) side
      const afterLineNumDiv = htmlRow.querySelector('.after .line-number')
      if (afterLineNumDiv) {
        const lineNumber = this.extractLineNumber(afterLineNumDiv)
        if (lineNumber !== null) {
          afterRanges = afterHighlights.get(lineNumber)
        }
      }

      const beforeSide = htmlRow.querySelector('.before') as HTMLElement
      const afterSide = htmlRow.querySelector('.after') as HTMLElement

      // Apply before side
      if (beforeSide) {
        if (beforeRanges && beforeRanges.length > 0) {
          beforeSide.classList.remove('component-filtered-side')
          beforeSide.classList.add('component-char-filtered')
          const contentWrapper = beforeSide.querySelector('.content-wrapper') as HTMLElement
          if (contentWrapper) {
            this.addCharHighlights(contentWrapper, beforeRanges, 'before')
          }
        } else {
          beforeSide.classList.add('component-filtered-side')
          beforeSide.classList.remove('component-char-filtered')
        }
      }

      // Apply after side
      if (afterSide) {
        if (afterRanges && afterRanges.length > 0) {
          afterSide.classList.remove('component-filtered-side')
          afterSide.classList.add('component-char-filtered')
          const contentWrapper = afterSide.querySelector('.content-wrapper') as HTMLElement
          if (contentWrapper) {
            this.addCharHighlights(contentWrapper, afterRanges, 'after')
          }
        } else {
          afterSide.classList.add('component-filtered-side')
          afterSide.classList.remove('component-char-filtered')
        }
      }

      // If both sides have no component ranges, mark the entire row as filtered
      if (!beforeRanges && !afterRanges) {
        htmlRow.classList.add('component-filtered')
      } else {
        htmlRow.classList.remove('component-filtered')
      }
    })
  }

  /**
   * Add absolute-positioned overlay spans on the content-wrapper to highlight
   * specific character ranges. Uses monospace `ch` units for positioning.
   */
  private addCharHighlights(
    contentWrapper: HTMLElement,
    ranges: Array<{startCol: number, endCol: number}>,
    side: 'before' | 'after'
  ): void {
    contentWrapper.style.position = 'relative'

    const highlightClass = side === 'before'
      ? 'component-char-highlight component-highlight-delete'
      : 'component-char-highlight component-highlight-add'

    for (const range of ranges) {
      // Positions are 0-based with exclusive end (e.g., "12-13" = 1 char at index 12)
      if (range.endCol <= range.startCol) continue

      const overlay = document.createElement('span')
      overlay.className = highlightClass
      overlay.style.left = `${range.startCol}ch`
      overlay.style.width = `${range.endCol - range.startCol}ch`
      contentWrapper.appendChild(overlay)
    }
  }

  /**
   * Get highlighted lines with character-level column ranges for the selected component.
   * Returns entries with line number, side (before/after), and the specific column ranges.
   */
  private getHighlightedLinesForComponent(filePath: string): Array<{line: number, side: 'before' | 'after', ranges: Array<{startCol: number, endCol: number}>}> {
    if (this.state.selectedComponent === 'all') {
      return []
    }

    const component = this.state.diffComponents[this.state.selectedComponent as number]
    if (!component || !component.changes) {
      return []
    }

    // Collect ranges per line-side combination
    const lineMap = new Map<string, {line: number, side: 'before' | 'after', ranges: Array<{startCol: number, endCol: number}>}>()

    for (const change of component.changes) {
      // "Removal" = edge existed in before but not after -> positions are in the before file
      // "Addition" = edge exists in after but not before -> positions are in the after file
      const side: 'before' | 'after' = change.kind === 'Removal' ? 'before' : 'after'

      // Process "from" field
      if (change.from && change.from.file === filePath && change.from.position) {
        this.addPositionToLineMap(lineMap, change.from.position, side)
      }

      // Process "to" field
      if (change.to && change.to.file === filePath && change.to.position) {
        this.addPositionToLineMap(lineMap, change.to.position, side)
      }
    }

    return Array.from(lineMap.values())
  }

  /**
   * Parse a position string like "5:12-13" and add it to the line map.
   * Format: "line:startCol-endCol" where columns are 0-based, endCol is exclusive.
   */
  private addPositionToLineMap(
    lineMap: Map<string, {line: number, side: 'before' | 'after', ranges: Array<{startCol: number, endCol: number}>}>,
    position: string,
    side: 'before' | 'after'
  ): void {
    const parts = position.split(':')
    if (parts.length < 2) return

    const lineNum = parseInt(parts[0], 10)
    const colParts = parts[1].split('-')
    if (colParts.length < 2) return

    const startCol = parseInt(colParts[0], 10)
    const endCol = parseInt(colParts[1], 10)

    // Skip empty ranges (e.g., "7:34-34")
    if (endCol <= startCol) return

    const key = `${lineNum}-${side}`
    const existing = lineMap.get(key)
    if (existing) {
      // Add range to existing entry (may overlap, that's OK for overlays)
      existing.ranges.push({ startCol, endCol })
    } else {
      lineMap.set(key, { line: lineNum, side, ranges: [{ startCol, endCol }] })
    }
  }

  private getStatusLabel(kind: AppFileStatusKind): string {
    switch (kind) {
      case AppFileStatusKind.New:
        return 'Added'
      case AppFileStatusKind.Modified:
        return 'Modified'
      case AppFileStatusKind.Deleted:
        return 'Deleted'
      case AppFileStatusKind.Renamed:
        return 'Renamed'
      case AppFileStatusKind.Copied:
        return 'Copied'
      case AppFileStatusKind.Conflicted:
        return 'Conflicted'
      case AppFileStatusKind.Untracked:
        return 'Untracked'
      default:
        return 'Unknown'
    }
  }

  private onFolderSelectorDismissed = () => {
    // User closed the dialog without selecting folders
    // For now, just keep it open
  }

  private onCompareFolders = async (beforeFolder: string, afterFolder: string) => {
    this.setState({
      showFolderSelector: false,
      beforeFolder,
      afterFolder,
      isLoading: true,
    })

    try {
      const fileChanges = await this.compareDirectories(beforeFolder, afterFolder)
      
      // Load diff components
      await this.loadDiffComponents(beforeFolder, afterFolder)
      
      this.setState({
        fileChanges,
        isLoading: false,
        isLoadingDiffs: true,
      })
      
      // Load all diffs
      await this.loadAllDiffs(beforeFolder, afterFolder, fileChanges)
      
      this.setState({
        isLoadingDiffs: false,
      })
    } catch (error) {
      console.error('Error comparing folders:', error)
      this.setState({ 
        isLoading: false,
        isLoadingDiffs: false,
      })
    }
  }

  private onComponentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    this.setState({
      selectedComponent: value === 'all' ? 'all' : parseInt(value, 10)
    })
  }

  private async loadDiffComponents(beforeFolder: string, afterFolder: string): Promise<void> {
    try {
      // Relative path to diff_components.json from the workspace root
      const diffComponentsPath = Path.resolve(__dirname, '../../../../../difftastic/Files/diff_components.json')
      const content = await FSPromises.readFile(diffComponentsPath, 'utf-8')
      const data = JSON.parse(content)
      
      if (data.diff_components && Array.isArray(data.diff_components)) {
        this.setState({ diffComponents: data.diff_components })
      }
    } catch (error) {
      console.log('No diff_components.json found or error loading it:', error)
      this.setState({ diffComponents: [] })
    }
  }

  private onChangeFolders = () => {
    this.setState({
      showFolderSelector: true,
      fileChanges: [],
      fileDiffs: new Map(),
    })
  }

  private async loadAllDiffs(
    beforeFolder: string,
    afterFolder: string,
    files: ReadonlyArray<WorkingDirectoryFileChange>
  ): Promise<void> {
    const newDiffs = new Map<string, ITextDiff | null>()
    
    // Load diffs for all files
    for (const file of files) {
      try {
        const diff = await computeDiff(beforeFolder, afterFolder, file)
        newDiffs.set(file.id, diff)
      } catch (error) {
        console.error(`Error loading diff for ${file.path}:`, error)
        newDiffs.set(file.id, null)
      }
      
      // Update state progressively so user sees diffs loading
      this.setState({
        fileDiffs: new Map(newDiffs)
      })
    }
  }

  private async compareDirectories(
    beforePath: string,
    afterPath: string
  ): Promise<ReadonlyArray<WorkingDirectoryFileChange>> {
    const changes: WorkingDirectoryFileChange[] = []
    
    // Get all files from both directories
    const beforeFiles = await this.getAllFiles(beforePath)
    const afterFiles = await this.getAllFiles(afterPath)
    
    // Create a set for faster lookup
    const afterFileSet = new Set(afterFiles.map(f => f.relativePath))
    const beforeFileSet = new Set(beforeFiles.map(f => f.relativePath))
    
    // Find deleted files (in before but not in after)
    for (const beforeFile of beforeFiles) {
      if (!afterFileSet.has(beforeFile.relativePath)) {
        changes.push(this.createFileChange(beforeFile.relativePath, AppFileStatusKind.Deleted))
      }
    }
    
    // Find new files (in after but not in before)
    for (const afterFile of afterFiles) {
      if (!beforeFileSet.has(afterFile.relativePath)) {
        changes.push(this.createFileChange(afterFile.relativePath, AppFileStatusKind.New))
      }
    }
    
    // Find modified files (in both but different)
    for (const beforeFile of beforeFiles) {
      if (afterFileSet.has(beforeFile.relativePath)) {
        const afterFile = afterFiles.find(f => f.relativePath === beforeFile.relativePath)!
        
        // Compare file contents
        const beforeContent = await FSPromises.readFile(beforeFile.fullPath, 'utf-8').catch(() => null)
        const afterContent = await FSPromises.readFile(afterFile.fullPath, 'utf-8').catch(() => null)
        
        if (beforeContent !== null && afterContent !== null && beforeContent !== afterContent) {
          changes.push(this.createFileChange(beforeFile.relativePath, AppFileStatusKind.Modified))
        }
      }
    }
    
    return changes
  }

  private async getAllFiles(
    directoryPath: string,
    basePath: string = directoryPath
  ): Promise<Array<{ fullPath: string; relativePath: string }>> {
    const results: Array<{ fullPath: string; relativePath: string }> = []
    
    try {
      const entries = await FSPromises.readdir(directoryPath, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = Path.join(directoryPath, entry.name)
        
        if (entry.isDirectory()) {
          // Recursively get files from subdirectories
          const subFiles = await this.getAllFiles(fullPath, basePath)
          results.push(...subFiles)
        } else if (entry.isFile()) {
          const relativePath = Path.relative(basePath, fullPath).replace(/\\/g, '/')
          results.push({ fullPath, relativePath })
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${directoryPath}:`, error)
    }
    
    return results
  }

  private createFileChange(
    path: string,
    kind: AppFileStatusKind
  ): WorkingDirectoryFileChange {
    return new WorkingDirectoryFileChange(
      path,
      { kind: kind } as any,
      DiffSelection.fromInitialSelection(DiffSelectionType.All)
    )
  }
}
