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
  readonly diffNodes: any[]
  readonly selectedComponent: number | 'all'
  readonly selectedNodeInfo: {
    javaId: number
    type: string
    content: string
    position: string
    file: string
    componentIndex: number
  } | null
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
      diffNodes: [],
      selectedComponent: 'all',
      selectedNodeInfo: null,
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
              width: '350px',
              borderRight: '1px solid var(--box-border-color)',
              backgroundColor: 'var(--box-alt-background-color)',
              padding: '15px',
              overflow: 'auto'
            }}>
              <style>{`
                .node-line-content::-webkit-scrollbar {
                  height: 8px !important;
                }
                .node-line-content::-webkit-scrollbar-thumb {
                  background-color: #888 !important;
                  border-radius: 4px;
                }
                .node-line-content::-webkit-scrollbar-thumb:hover {
                  background-color: #666 !important;
                }
                .node-line-content::-webkit-scrollbar-track {
                  background: rgba(127,127,127,0.15) !important;
                  border-radius: 4px;
                }
              `}</style>
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
                {this.state.diffComponents.map((comp, index) => {
                  const isSelected = this.state.selectedComponent === index
                  const nodeData = this.state.diffNodes.find((n: any) => n.component_id === comp.component_id)
                  const nodes: any[] = nodeData ? nodeData.nodes : []
                  return (
                    <div key={index}>
                      <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        padding: '8px',
                        borderRadius: '4px',
                        backgroundColor: isSelected ? 'var(--background-color)' : 'transparent'
                      }}>
                        <input
                          type="radio"
                          name="component-view"
                          value={index}
                          checked={isSelected}
                          onChange={this.onComponentChange}
                        />
                        <span style={{ fontSize: '13px' }}>Component {index + 1}</span>
                      </label>
                      {isSelected && nodes.length > 0 && (() => {
                        // Find the node with the highest reachable_by score
                        let maxReachableBy = -1
                        let maxReachableIndex = -1
                        let maxReachableCount = 0
                        nodes.forEach((n: any, i: number) => {
                          if (typeof n.reachable_by === 'number') {
                            if (n.reachable_by > maxReachableBy) {
                              maxReachableBy = n.reachable_by
                              maxReachableIndex = i
                              maxReachableCount = 1
                            } else if (n.reachable_by === maxReachableBy) {
                              maxReachableCount++
                            }
                          }
                        })
                        return (
                        <div style={{ marginLeft: '22px', borderLeft: '1px solid var(--box-border-color)', paddingLeft: '8px', marginBottom: '4px' }}>
                          {nodes.map((node: any, ni: number) => {
                            const lineNum = node.position ? node.position.split(':')[0] : '?'
                            const side: 'before' | 'after' = nodeData?.kind === 'Removal' ? 'before' : 'after'
                            const lineContent = this.getSourceLineContent(node.file, parseInt(lineNum, 10), side)
                            const isLikelySource = ni === maxReachableIndex && maxReachableBy > 0 && maxReachableCount === 1
                            return (
                              <React.Fragment key={ni}>
                              {isLikelySource && (
                                <div style={{
                                  fontSize: '9px',
                                  color: '#e8a63a',
                                  fontWeight: 600,
                                  padding: '2px 6px 0px 6px',
                                  whiteSpace: 'nowrap'
                                }}>
                                  Likely source
                                </div>
                              )}
                              <div style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                padding: '6px 6px',
                                fontSize: '11px',
                                borderRadius: '3px',
                                color: 'var(--text-secondary-color)',
                                gap: '6px',
                                minHeight: '28px'
                              }}>
                                <span
                                  title={`${node.type}: ${node.content || '(no content)'}`}
                                  style={{ fontFamily: 'var(--font-family-monospace)', whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0 }}
                                  onClick={() => this.selectNode(node, index, side)}
                                >
                                  {lineNum}
                                </span>
                                <span
                                  className="node-line-content"
                                  title={lineContent}
                                  style={{ fontFamily: 'var(--font-family-monospace)', whiteSpace: 'nowrap', overflowX: 'auto', cursor: 'pointer', flex: 1, minWidth: 0 }}
                                  onClick={() => this.selectNode(node, index, side)}
                                >
                                  {lineContent}
                                </span>
                                <span
                                  style={{ fontSize: '10px', color: 'var(--diff-selected-border-color)', flexShrink: 0, cursor: 'pointer' }}
                                  onClick={() => this.selectNode(node, index, side)}
                                >
                                  {node.file || ''}
                                </span>
                              </div>
                              </React.Fragment>
                            )
                          })}
                        </div>
                        )
                      })()}
                    </div>
                  )
                })}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <Button onClick={this.onChangeFolders}>Change Folders</Button>
                {this.state.fileChanges.length > 0 && (
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary-color)' }}>
                    {this.state.fileChanges.length} changed {this.state.fileChanges.length === 1 ? 'file' : 'files'}
                  </span>
                )}
              </div>
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
                padding: '0 20px 20px 20px'
              }}>
            <div>
              {this.state.fileChanges.map((file, index) => (
                <div key={file.id} data-file-path={file.path} style={{ 
                  border: '1px solid var(--box-border-color)',
                  borderRadius: '6px',
                  marginTop: index === 0 ? 0 : '20px',
                  marginBottom: index === this.state.fileChanges.length - 1 ? '0' : '0',
                  backgroundColor: 'var(--box-background-color)'
                }}>
                  <div style={{ 
                    padding: '15px 20px', 
                    paddingTop: '35px',
                    marginTop: '-20px',
                    backgroundColor: 'var(--box-alt-background-color)',
                    borderBottom: '1px solid var(--box-border-color)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                    borderTopLeftRadius: '6px',
                    borderTopRightRadius: '6px'
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

          {/* Right Panel for Node Details */}
          {this.renderNodePanel()}
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
    
    // Give AutoSizer a very large height so react-virtualized renders ALL rows
    // (disabling virtualization). CSS on the wrapper clips the empty space.
    return (
      <div className="diff-size-wrapper" style={{ height: '100000px', display: 'flex', flexDirection: 'column' }}>
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
            background: var(--background-color) !important;
            color: var(--diff-text-color) !important;
          }
          
          .folder-compare-view .component-filtered .line-number,
          .folder-compare-view .component-filtered .line-number label,
          .folder-compare-view .component-filtered .line-number span,
          .folder-compare-view .component-filtered-side .line-number,
          .folder-compare-view .component-filtered-side .line-number label,
          .folder-compare-view .component-filtered-side .line-number span {
            background-color: var(--diff-gutter-background-color) !important;
            color: var(--text-secondary-color) !important;
          }
          
          .folder-compare-view .component-filtered .line-number.line-selected,
          .folder-compare-view .component-filtered-side .line-number.line-selected {
            background-color: var(--diff-gutter-background-color) !important;
          }
          
          .folder-compare-view .component-filtered .content,
          .folder-compare-view .component-filtered .content-wrapper,
          .folder-compare-view .component-filtered-side .content,
          .folder-compare-view .component-filtered-side .content-wrapper {
            background: var(--background-color) !important;
            color: var(--diff-text-color) !important;
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
          
          .folder-compare-view .component-filtered .cm-diff-delete-inner,
          .folder-compare-view .component-filtered .cm-diff-add-inner,
          .folder-compare-view .component-filtered-side .cm-diff-delete-inner,
          .folder-compare-view .component-filtered-side .cm-diff-add-inner {
            color: var(--diff-text-color) !important;
          }
          
          .folder-compare-view .component-filtered .diff-line-gutter,
          .folder-compare-view .component-filtered-side .diff-line-gutter {
            background-color: transparent !important;
          }
          


          /* Make dividers gray by default, then blue only for changed rows */
          .folder-compare-view .hunk-handle-place-holder,
          .folder-compare-view .hunk-handle-place-holder.selected {
            background-color: var(--diff-empty-hunk-handle) !important;
            position: absolute !important;
            left: calc(50% - var(--hunk-handle-width) / 2) !important;
            width: var(--hunk-handle-width) !important;
            height: 100% !important;
            pointer-events: none !important;
            z-index: 10 !important;
          }
          .folder-compare-view .row.added .hunk-handle-place-holder,
          .folder-compare-view .row.deleted .hunk-handle-place-holder,
          .folder-compare-view .row.modified .hunk-handle-place-holder {
            background-color: var(--diff-selected-border-color) !important;
          }
          .folder-compare-view .component-filtered .hunk-handle-place-holder,
          .folder-compare-view .component-filtered .hunk-handle-place-holder.selected {
            background-color: var(--diff-gutter-color) !important;
          }

          /* Hide blue increased-hover-surface, focus-handle, and hunk-handle for filtered rows */
          .folder-compare-view .component-filtered .increased-hover-surface,
          .folder-compare-view .component-filtered .focus-handle,
          .folder-compare-view .component-filtered .hunk-handle {
            display: none !important;
          }

          /* === Character-level filtered sides (line is in component but only specific chars highlighted) === */
          /* Clear only the inner cm-diff character highlights so our overlays show.
             Keep the line-level background (dark red/green) intact. */
          .folder-compare-view .component-char-filtered .cm-diff-delete,
          .folder-compare-view .component-char-filtered .cm-diff-add,
          .folder-compare-view .component-char-filtered .cm-diff-delete-bg,
          .folder-compare-view .component-char-filtered .cm-diff-add-bg,
          .folder-compare-view .component-char-filtered span[class*="cm-diff"] {
            background-color: transparent !important;
          }

          /* Character-level highlight overlays — z-index:-1 so they sit
             above the content-wrapper background but below normal-flow text
             (including bare text nodes that can't receive z-index). */
          .folder-compare-view .component-char-highlight {
            position: absolute;
            top: 20%;
            bottom: 20%;
            pointer-events: none;
            z-index: -1;
          }
          .folder-compare-view .component-highlight-add {
            background-color: var(--diff-add-inner-background-color);
          }
          .folder-compare-view .component-highlight-delete {
            background-color: var(--diff-delete-inner-background-color);
          }

          /* content-wrapper stacking context is created in addCharHighlights
             (position:relative + z-index:0).  With the overlay at z-index:-1
             all normal-flow text—including bare text nodes—renders on top. */

          /* Content doesn't wrap; overflow hidden prevents per-line scrolling.
             Programmatic scrollLeft still works with overflow:hidden. */
          .folder-compare-view .content {
            white-space: pre !important;
            word-break: normal !important;
            overflow: hidden !important;
          }
          .folder-compare-view .content-wrapper {
            white-space: pre !important;
          }
          /* Clip box-shadow from sticky scrollbar so it doesn't bleed
             into the gap between files.  overflow:clip does NOT create
             a scroll container, so sticky positioning still works. */
          .folder-compare-view [data-file-path] {
            overflow: clip;
          }
          /* Master scrollbar per side at bottom of each file diff */
          .folder-compare-view .scroll-sync-bar {
            display: flex;
            border-top: 1px solid var(--box-border-color);
            background: var(--box-background-color);
            position: sticky;
            bottom: 0;
            z-index: 10;
            box-shadow: 0 50px 0 50px var(--box-background-color);
          }
          .folder-compare-view .scroll-sync-bar > div {
            overflow-x: scroll;
            overflow-y: hidden;
          }
          .folder-compare-view .scroll-sync-bar > div::-webkit-scrollbar {
            height: 8px;
          }
          .folder-compare-view .scroll-sync-bar > div::-webkit-scrollbar-thumb {
            background-color: rgba(127,127,127,0.5);
            border-radius: 4px;
          }
          .folder-compare-view .scroll-sync-bar > div::-webkit-scrollbar-thumb:hover {
            background-color: rgba(127,127,127,0.7);
          }
          .folder-compare-view .scroll-sync-bar > div::-webkit-scrollbar-track {
            background: rgba(127,127,127,0.1);
            border-radius: 4px;
          }
        `}</style>
      </div>
    )
  }

  private mutationObserver: MutationObserver | null = null
  private isApplyingHighlighting = false
  private highlightingRAF: number | null = null
  private diffHeightsAdjusted = false

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

    // After all diffs finish loading, shrink wrappers to fit content
    if (!this.state.isLoadingDiffs && this.state.fileDiffs.size > 0 && !this.diffHeightsAdjusted) {
      this.diffHeightsAdjusted = true
      // Wait for react-virtualized to render all rows inside the large container
      setTimeout(() => {
        this.shrinkWrappersToFit()
        this.setupScrollSync()
      }, 500)
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
      document.querySelectorAll('.folder-compare-view .component-char-click-capture').forEach(el => el.remove())
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
    fileContainer.querySelectorAll('.component-char-click-capture').forEach(el => el.remove())
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
    contentWrapper.style.zIndex = '0'  // create stacking context so z-index:-1 overlays sit below text

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

      // Transparent click-capture overlay on top for node selection
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
      clickCapture.addEventListener('mousedown', this.handleCharHighlightClick)
      contentWrapper.appendChild(clickCapture)
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

  /**
   * Look up the full source line content from the loaded diff data.
   */
  private getSourceLineContent(fileName: string, lineNum: number, side: 'before' | 'after'): string {
    // fileDiffs is keyed by file.id (e.g. "modified+Prog.java"), but fileName
    // is just the bare name from diff_nodes.json (e.g. "Prog.java").
    // Find the matching entry by checking if the key ends with +fileName.
    let diff: ITextDiff | null | undefined
    for (const [key, value] of this.state.fileDiffs.entries()) {
      if (key === fileName || key.endsWith('+' + fileName)) {
        diff = value
        break
      }
    }
    if (!diff) return ''

    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        const matchLine = side === 'before' ? line.oldLineNumber : line.newLineNumber
        if (matchLine === lineNum) {
          return line.content.trimEnd()
        }
      }
    }
    return ''
  }

  /**
   * After all diffs have rendered, measure each inner scroll container and
   * shrink the wrapper + Grid to exactly that height.  This also locks the
   * Grid's height so AutoSizer's resize doesn't trigger re-virtualization.
   */
  private shrinkWrappersToFit(): void {
    // Temporarily disconnect observer to avoid an infinite loop
    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
    }

    document.querySelectorAll('.folder-compare-view .diff-size-wrapper').forEach(wrapper => {
      const el = wrapper as HTMLElement
      const inner = el.querySelector(
        '.ReactVirtualized__Grid__innerScrollContainer'
      ) as HTMLElement
      const grid = el.querySelector(
        '.ReactVirtualized__Grid'
      ) as HTMLElement

      if (inner && inner.scrollHeight > 0) {
        const contentHeight = inner.scrollHeight + 2  // +2 for border-bottom and rounding
        el.style.height = `${contentHeight}px`
        // Lock Grid height so AutoSizer resize doesn't cause re-virtualization
        if (grid) {
          grid.style.height = `${contentHeight}px`
          grid.style.overflow = 'hidden'
        }
      }
    })

    // Reconnect observer
    if (this.mutationObserver) {
      const container = document.querySelector('.folder-compare-view')
      if (container) {
        this.mutationObserver.observe(container, {
          childList: true,
          subtree: true,
        })
      }
    }
  }

  /**
   * For each file, add a master horizontal scrollbar per side (before/after)
   * at the bottom of the diff. All content lines on the same side scroll
   * together via synchronized scrollLeft.
   */
  private setupScrollSync(): void {
    document.querySelectorAll('.folder-compare-view [data-file-path]').forEach(fileContainer => {
      const diffContainer = fileContainer.querySelector('.diff-container') as HTMLElement
      if (!diffContainer) return

      // Skip if already set up
      if (diffContainer.querySelector('.scroll-sync-bar')) return

      const beforeContents = Array.from(fileContainer.querySelectorAll('.before .content')) as HTMLElement[]
      const afterContents = Array.from(fileContainer.querySelectorAll('.after .content')) as HTMLElement[]

      if (beforeContents.length === 0 && afterContents.length === 0) return

      // Find max scroll width for each side
      const maxBeforeSW = Math.max(0, ...beforeContents.map(el => el.scrollWidth))
      const maxAfterSW = Math.max(0, ...afterContents.map(el => el.scrollWidth))

      const firstBefore = beforeContents[0]
      const firstAfter = afterContents[0]
      const beforeOverflows = firstBefore && maxBeforeSW > firstBefore.clientWidth + 2
      const afterOverflows = firstAfter && maxAfterSW > firstAfter.clientWidth + 2

      if (!beforeOverflows && !afterOverflows) return

      // Create sync bar container — always create both halves
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

      // Defer width calculation until the sync bar is laid out
      requestAnimationFrame(() => {
        // Use the max scrollWidth across both sides so both scrollbars
        // have the same range and both sides are always scrollable.
        const maxSW = Math.max(maxBeforeSW, maxAfterSW)
        // Set inner width = maxScrollWidth.  The bar's visible portion
        // (clientWidth) is roughly the same as the content's clientWidth,
        // so scrollLeftMax ≈ maxSW - clientWidth, matching the overflow.
        beforeInner.style.width = `${maxSW}px`
        afterInner.style.width = `${maxSW}px`
      })

      // Scroll handler: translateX all .content-wrapper elements on that side.
      // Unlike scrollLeft (which only affects lines whose content overflows),
      // transform moves EVERY line by the same amount.
      // Always attach handlers for both sides so both scrollbars work.
      beforeBar.addEventListener('scroll', () => {
        const sl = beforeBar.scrollLeft
        beforeContents.forEach(el => {
          const w = el.querySelector('.content-wrapper') as HTMLElement
          if (w) w.style.transform = `translateX(-${sl}px)`
        })
      })

      afterBar.addEventListener('scroll', () => {
        const sl = afterBar.scrollLeft
        afterContents.forEach(el => {
          const w = el.querySelector('.content-wrapper') as HTMLElement
          if (w) w.style.transform = `translateX(-${sl}px)`
        })
      })
    })
  }

  private selectNode(node: any, componentIndex: number, side: 'before' | 'after'): void {
    const lineNum = node.position ? parseInt(node.position.split(':')[0], 10) : NaN
    this.setState({
      selectedNodeInfo: {
        javaId: node.java_id,
        type: node.type,
        content: node.content || '',
        position: node.position,
        file: node.file,
        componentIndex
      }
    })
    if (!isNaN(lineNum)) {
      this.scrollToLine(node.file, lineNum, side)
    }
  }

  private scrollToFile(fileName: string): void {
    const container = document.querySelector(`.folder-compare-view [data-file-path="${fileName}"]`) as HTMLElement
    if (container) {
      container.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  private scrollToLine(fileName: string, lineNum: number, side: 'before' | 'after'): void {
    const fileContainer = document.querySelector(`.folder-compare-view [data-file-path="${fileName}"]`)
    if (!fileContainer) return

    // Find the row containing a label with for="{lineNum}-{side}"
    const label = fileContainer.querySelector(`label[for="${lineNum}-${side}"]`)
    if (label) {
      const row = label.closest('.row') as HTMLElement
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // Brief flash highlight
        row.style.outline = '2px solid var(--diff-selected-border-color)'
        setTimeout(() => { row.style.outline = '' }, 1500)
        return
      }
    }

    // Fallback: scroll to file
    this.scrollToFile(fileName)
  }

  private handleCharHighlightClick = (event: Event) => {
    event.stopPropagation()
    const target = event.currentTarget as HTMLElement
    if (!target) return

    const startCol = parseInt(target.dataset.startCol || '0', 10)
    const endCol = parseInt(target.dataset.endCol || '0', 10)
    const side = target.dataset.side as 'before' | 'after'

    // Walk up DOM to find line number and file path
    const row = target.closest('.row') as HTMLElement
    if (!row) return

    const lineNumDiv = row.querySelector(`.${side} .line-number`)
    if (!lineNumDiv) return
    const lineNumber = this.extractLineNumber(lineNumDiv)
    if (lineNumber === null) return

    const fileContainer = target.closest('[data-file-path]') as HTMLElement
    if (!fileContainer) return
    const filePath = fileContainer.dataset.filePath || ''

    if (this.state.selectedComponent === 'all') return
    const componentIndex = this.state.selectedComponent as number
    const component = this.state.diffComponents[componentIndex]
    if (!component) return

    const pos = `${lineNumber}:${startCol}-${endCol}`

    // Search edges for a matching from/to node at this position
    for (const change of component.changes) {
      if (change.from && change.from.file === filePath && change.from.position === pos) {
        this.setState({
          selectedNodeInfo: {
            javaId: change.from.java_id,
            type: change.from.type,
            content: change.from.content || '',
            position: change.from.position,
            file: change.from.file,
            componentIndex
          }
        })
        return
      }
      if (change.to && change.to.file === filePath && change.to.position === pos) {
        this.setState({
          selectedNodeInfo: {
            javaId: change.to.java_id,
            type: change.to.type,
            content: change.to.content || '',
            position: change.to.position,
            file: change.to.file,
            componentIndex
          }
        })
        return
      }
    }
  }

  private closeNodePanel = () => {
    this.setState({ selectedNodeInfo: null })
  }

  private renderNodePanel(): JSX.Element | null {
    const info = this.state.selectedNodeInfo
    if (!info) return null

    const componentIndex = info.componentIndex
    const component = this.state.diffComponents[componentIndex]
    if (!component) return null

    // Find all edges involving this node
    const connectedEdges: Array<{edge: any, otherNode: any, direction: 'incoming' | 'outgoing'}> = []
    for (const change of component.changes) {
      if (change.from && change.from.java_id === info.javaId) {
        connectedEdges.push({ edge: change, otherNode: change.to, direction: 'outgoing' })
      }
      if (change.to && change.to.java_id === info.javaId) {
        connectedEdges.push({ edge: change, otherNode: change.from, direction: 'incoming' })
      }
    }

    // Look up the node in diff_nodes.json for additional info
    const nodeData = this.state.diffNodes.find((n: any) => n.component_id === component.component_id)
    const diffNode = nodeData?.nodes?.find((n: any) => n.java_id === info.javaId)

    return (
      <div style={{
        width: '350px',
        borderLeft: '1px solid var(--box-border-color)',
        backgroundColor: 'var(--box-alt-background-color)',
        padding: '15px',
        overflow: 'auto',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Node Details</h3>
          <span
            style={{ cursor: 'pointer', fontSize: '18px', padding: '2px 6px', lineHeight: 1 }}
            onClick={this.closeNodePanel}
            title="Close panel"
          >&times;</span>
        </div>

        <div style={{ fontSize: '12px', marginBottom: '15px', padding: '10px', backgroundColor: 'var(--background-color)', borderRadius: '4px' }}>
          <div style={{ marginBottom: '4px' }}><strong>Type:</strong> {info.type}</div>
          {info.content && <div style={{ marginBottom: '4px' }}><strong>Content:</strong> <code style={{ fontFamily: 'var(--font-family-monospace)' }}>{info.content}</code></div>}
          <div style={{ marginBottom: '4px' }}><strong>File:</strong> {info.file}</div>
          <div style={{ marginBottom: '4px' }}><strong>Position:</strong> {info.position}</div>
          <div style={{ marginBottom: '4px' }}><strong>Component:</strong> {componentIndex + 1} ({nodeData?.kind || ''})</div>
          {diffNode && typeof diffNode.reachable_by === 'number' && (
            <div><strong>Reachable by:</strong> {diffNode.reachable_by} node{diffNode.reachable_by !== 1 ? 's' : ''}</div>
          )}
        </div>

        <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 600 }}>
          Connected Edges ({connectedEdges.length})
        </h4>

        {connectedEdges.length === 0 && (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary-color)', fontStyle: 'italic' }}>
            No direct edges for this node
          </div>
        )}

        {connectedEdges.map((conn, i) => {
          const edgeLabelParts = (conn.edge.edge_label || '').split(':')
          const edgeType = edgeLabelParts[0] || ''
          return (
            <div key={i} style={{
              fontSize: '11px',
              padding: '8px',
              marginBottom: '6px',
              backgroundColor: 'var(--background-color)',
              borderRadius: '4px',
              borderLeft: '3px solid var(--diff-selected-border-color)',
              cursor: 'pointer'
            }}
            onClick={() => {
              if (conn.otherNode) {
                this.setState({
                  selectedNodeInfo: {
                    javaId: conn.otherNode.java_id,
                    type: conn.otherNode.type,
                    content: conn.otherNode.content || '',
                    position: conn.otherNode.position,
                    file: conn.otherNode.file,
                    componentIndex
                  }
                })
                const lineNum = parseInt((conn.otherNode.position || '').split(':')[0], 10)
                if (!isNaN(lineNum)) {
                  const side: 'before' | 'after' = conn.edge.kind === 'Removal' ? 'before' : 'after'
                  this.scrollToLine(conn.otherNode.file, lineNum, side)
                }
              }
            }}
            >
              <div style={{ marginBottom: '4px', fontSize: '10px', color: 'var(--text-secondary-color)', cursor: 'inherit' }}>
                {conn.direction === 'incoming' ? '\u2190 ' : '\u2192 '}<strong style={{ cursor: 'inherit' }}>{edgeType}</strong>
              </div>
              <div style={{ marginBottom: '2px', cursor: 'inherit' }}>
                {conn.otherNode?.type || '?'}
              </div>
              {conn.otherNode?.content && (
                <div style={{ marginBottom: '2px', fontFamily: 'var(--font-family-monospace)', color: 'var(--text-color)', cursor: 'inherit' }}>
                  {conn.otherNode.content}
                </div>
              )}
              <div style={{ color: 'var(--text-secondary-color)', cursor: 'inherit' }}>
                {conn.otherNode?.file} : {conn.otherNode?.position}
              </div>
            </div>
          )
        })}
      </div>
    )
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
      selectedComponent: value === 'all' ? 'all' : parseInt(value, 10),
      selectedNodeInfo: null,
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

    try {
      const diffNodesPath = Path.resolve(__dirname, '../../../../../difftastic/Files/diff_nodes.json')
      const nodesContent = await FSPromises.readFile(diffNodesPath, 'utf-8')
      const nodesData = JSON.parse(nodesContent)

      if (nodesData.diff_components && Array.isArray(nodesData.diff_components)) {
        this.setState({ diffNodes: nodesData.diff_components })
      }
    } catch (error) {
      console.log('No diff_nodes.json found or error loading it:', error)
      this.setState({ diffNodes: [] })
    }
  }

  private onChangeFolders = () => {
    this.diffHeightsAdjusted = false
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
