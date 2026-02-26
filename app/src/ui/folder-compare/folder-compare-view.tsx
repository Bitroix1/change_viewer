import * as React from 'react'
import { Button } from '../lib/button'
import { Dispatcher } from '../dispatcher'
import { FolderSelector } from './folder-selector'
import { WorkingDirectoryFileChange } from '../../models/status'
import { AppFileStatusKind } from '../../models/status'
import { ITextDiff, ImageDiffType } from '../../models/diff'
import { Diff } from '../diff'
import { Repository } from '../../models/repository'

// -- Helper modules ----------------------------------------------------------
import {
  applyComponentHighlightingToAll,
  extractLineNumber,
} from './folder-compare-highlight'
import { repackFile, shrinkWrappersToFit, setupScrollSync } from './folder-compare-repack'
import {
  loadDiffComponents,
  loadAllDiffs,
  compareDirectories,
  getSourceLineContent,
} from './folder-compare-data'

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
  readonly collapsedKinds: ReadonlyArray<string>
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
      collapsedKinds: [],
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
              <h3 style={{ margin: '0 0 15px 0', fontSize: '14px', fontWeight: 600 }}>Diff View Options</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px',
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '4px',
                  backgroundColor: this.state.selectedComponent === 'all' ? 'var(--box-border-color)' : 'var(--background-color)'
                }}>
                  <input
                    type="radio"
                    name="component-view"
                    value="all"
                    checked={this.state.selectedComponent === 'all'}
                    onChange={this.onComponentChange}
                  />
                  <span style={{ fontSize: '13px' }}>Show All<br></br></span>
                </label>
                {(() => {
                  // Group components by component_kind
                  const kindGroups = new Map<string, Array<{comp: any, index: number}>>()
                  this.state.diffComponents.forEach((comp, index) => {
                    const kind = comp.component_kind || 'other'
                    const group = kindGroups.get(kind)
                    if (group) {
                      group.push({ comp, index })
                    } else {
                      kindGroups.set(kind, [{ comp, index }])
                    }
                  })

                  const kindLabels: Record<string, string> = {
                    delete: 'Deletions',
                    add: 'Additions',
                    rename: 'Renames',
                    modify: 'Modifications',
                    other: 'Other',
                  }

                  return Array.from(kindGroups.entries()).map(([kind, items]) => {
                    const isCollapsed = this.state.collapsedKinds.includes(kind)
                    const label = kindLabels[kind] || kind.charAt(0).toUpperCase() + kind.slice(1) + 's'
                    return (
                      <div key={kind} style={{ marginBottom: '4px' }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            cursor: 'pointer',
                            padding: '6px 8px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--box-border-color)',
                            fontSize: '12px',
                            fontWeight: 600,
                            userSelect: 'none',
                          }}
                          onClick={() => this.toggleKindCollapse(kind)}
                        >
                          <span style={{ fontSize: '10px', display: 'inline-block', transition: 'transform 0.15s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>&#9660;</span>
                          <span>{label}</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary-color)', marginLeft: 'auto' }}>({items.length})</span>
                        </div>
                        {!isCollapsed && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px', marginLeft: '8px' }}>
                            {items.map(({ comp, index }) => {
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
                                    padding: '6px 8px',
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
                                    <span style={{ fontSize: '12px' }}>{comp.component_name || `Component ${comp.component_id}`}</span>
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
                                        // Use the individual node's kind, not the component's kind
                                        const side: 'before' | 'after' = node.kind === 'Removal' ? 'before' : 'after'
                                        const isLikelySource = ni === maxReachableIndex && maxReachableBy > 0 && maxReachableCount === 1
                                        return (
                                          <div key={ni} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            padding: '6px 6px',
                                            fontSize: '11px',
                                            borderRadius: '3px',
                                            color: 'var(--text-secondary-color)',
                                            gap: '6px',
                                            minHeight: '28px'
                                          }}>
                                            <span
                                              className="node-line-content"
                                              style={{ 
                                                fontSize: '12px', 
                                                color: 'var(--diff-selected-border-color)', 
                                                cursor: 'pointer', 
                                                marginTop: '-1px',
                                                whiteSpace: 'nowrap',
                                                overflowX: 'auto',
                                                flex: 1,
                                                minWidth: 0
                                              }}
                                              onClick={() => this.selectNode(node, index, side)}
                                            >
                                              {node.file}::{lineNum}
                                            </span>
                                            {isLikelySource && (
                                              <span style={{
                                                fontSize: '9px',
                                                color: '#e8a63a',
                                                fontWeight: 600,
                                                whiteSpace: 'nowrap',
                                                flexShrink: 0
                                              }}>
                                                Likely source
                                              </span>
                                            )}
                                          </div>
                                        )
                                      })}
                                    </div>
                                    )
                                  })()}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div className="folder-compare-header" style={{ padding: '10px', borderBottom: '1px solid var(--box-border-color)', backgroundColor: 'var(--box-background-color)' }}>
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
                padding: '20px'
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
                    padding: '10px 20px', 
                    paddingTop: '10px',
                    marginTop: '0px',
                    backgroundColor: 'var(--box-alt-background-color)',
                    borderBottom: '1px solid var(--box-border-color)',
                    position: 'sticky',
                    top: -20,
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
    // (disabling virtualization).  The diff-clip-wrapper (not diff-size-wrapper)
    // is used for clipping so react-virtualized's resize observer never fires.
    return (
      <div className="diff-clip-wrapper" style={{ overflow: 'hidden' }}>
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
          /* CSS Variables for filtered line opacity - adjust these to change faintness */
          :root {
            --filtered-line-opacity: 0.05;
          }
          
          /* === Fully filtered rows/sides (not in component at all) === */
          /* Row-level backgrounds are always OPAQUE to prevent stacking.
             Faint tint is applied only ONCE, on the .before/.after sides. */
          .folder-compare-view .component-filtered {
            background-color: var(--background-color) !important;
          }
          .folder-compare-view .component-filtered.added,
          .folder-compare-view .component-filtered.deleted,
          .folder-compare-view .component-filtered.modified {
            background-color: var(--background-color) !important;
          }
          
          /* Binary faint coloring: left (before) = faint red, right (after) = faint green.
             Applied once per side — no stacking regardless of how many components touch the line. */
          .folder-compare-view .component-filtered .before,
          .folder-compare-view .component-filtered-side.before {
            background: rgba(255, 0, 0, var(--filtered-line-opacity)) !important;
            color: var(--diff-text-color) !important;
          }
          .folder-compare-view .component-filtered .after,
          .folder-compare-view .component-filtered-side.after {
            background: rgba(0, 255, 0, var(--filtered-line-opacity)) !important;
            color: var(--diff-text-color) !important;
          }
          
          /* Force override of line-number backgrounds for filtered lines */
          .folder-compare-view .component-filtered.added .line-number,
          .folder-compare-view .component-filtered.deleted .line-number {
            background-color: transparent !important;
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
            position: relative;
            z-index: 1;
          }
          .folder-compare-view .content-wrapper {
            white-space: pre !important;
          }
          /* Line numbers should appear above content */
          .folder-compare-view .line-number {
            position: relative;
            z-index: 2;
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

          /* === Hunk-based display: hide rows outside component hunks === */
          /* Use visibility:hidden instead of display:none so that
             CellMeasurer's ResizeObserver does not fire with height=0,
             which would corrupt its cache and cause ReactVirtualized
             to shrink row heights permanently.  Actual hiding is done
             by repackFile() pushing the row to top:-99999px. */
          .folder-compare-view .component-hidden {
            visibility: hidden !important;
          }

          /* Visual separator at the start of each custom hunk */
          .folder-compare-view .component-hunk-start {
            position: relative;
          }
          .folder-compare-view .component-hunk-start::before {
            content: '';
            display: block;
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 0;
            border-top: 1px solid var(--box-border-color);
            z-index: 5;
          }

          /* Hunk separator — absolutely positioned by repackFile() to match row layout */
          .folder-compare-view .component-hunk-separator {
            position: absolute;
            left: 0;
            right: 0;
            box-sizing: border-box;
            overflow: hidden;
          }

          /* ── "Show All" hunk-info rows: replace full header text with @@  @@ ── */
          .folder-compare-view .hunk-info:not(.component-hunk-separator) .content-wrapper {
            visibility: hidden;
          }
          .folder-compare-view .hunk-info:not(.component-hunk-separator) .content {
            display: flex;
            align-items: center;
          }
          .folder-compare-view .hunk-info:not(.component-hunk-separator) .content::before {
            content: '@@';
            visibility: visible;
            flex: 1;
            text-align: left;
            color: var(--diff-hunk-text-color);
            font-family: var(--font-family-monospace);
            padding-left: 4px;
          }
          .folder-compare-view .hunk-info:not(.component-hunk-separator) .content::after {
            content: '@@';
            visibility: visible;
            flex: 1;
            text-align: right;
            color: var(--diff-hunk-text-color);
            font-family: var(--font-family-monospace);
            padding-right: 40px;
          }

          /* Hide file containers that have no component changes.
             NEVER use display:none here — it removes elements from layout,
             causing ReactVirtualized's ResizeObserver to report 0-height
             rows, corrupting CellMeasurer's cache.  The Grid then either
             removes row DOM or zeroes their heights, making the file blank
             when switching back to "Show All".
             Instead we collapse the container visually while preserving
             internal layout so CellMeasurer is unaffected. */
          .folder-compare-view .component-file-hidden {
            max-height: 0 !important;
            overflow: hidden !important;
            visibility: hidden !important;
          }
        `}</style>
      </div>
      </div>
    )
  }

  private mutationObserver: MutationObserver | null = null
  private isApplyingHighlighting = false
  private highlightingRAF: number | null = null
  private diffHeightsAdjusted = false
  private shrinkPollingRAF: number | null = null

  public componentDidUpdate(prevProps: IFolderCompareViewProps, prevState: IFolderCompareViewState): void {
    // Apply highlighting when component selection changes
    if (prevState.selectedComponent !== this.state.selectedComponent) {
      // componentDidUpdate fires after React has committed DOM changes,
      // so a single animation frame is enough for the browser to settle.
      requestAnimationFrame(() => this.applyAndRepackAll())
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
        // Disconnect observer during initial layout to prevent loops
        if (this.mutationObserver) this.mutationObserver.disconnect()
        this.startShrinkPolling()
        setupScrollSync()
        if (this.mutationObserver) {
          const container = document.querySelector('.folder-compare-view')
          if (container) {
            this.mutationObserver.observe(container, { childList: true, subtree: true })
          }
        }
      }, 500)
    }
  }

  public componentWillUnmount(): void {
    this.cleanupMutationObserver()
  }

  private setupMutationObserver(): void {
    this.cleanupMutationObserver()

    this.mutationObserver = new MutationObserver((mutations) => {
      if (this.isApplyingHighlighting) return

      if (this.state.selectedComponent === 'all') return

      // Ignore mutations that consist *only* of our own separator
      // insertions/removals (class names starting with 'component-').
      // Those are produced by applyComponentHighlightingForFile and must not
      // re-trigger another highlighting pass, which would cause an infinite
      // re-apply loop and visual instability.
      const hasExternalMutations = mutations.some(m => {
        const isOurNode = (n: Node): boolean => {
          const el = n as Element
          return typeof el.classList !== 'undefined' &&
            (el.classList.contains('component-hunk-separator') ||
             el.classList.contains('component-char-highlight') ||
             el.classList.contains('component-char-click-capture'))
        }
        return (
          Array.from(m.addedNodes).some(n => !isOurNode(n)) ||
          Array.from(m.removedNodes).some(n => !isOurNode(n))
        )
      })
      if (!hasExternalMutations) return

      // Debounce via requestAnimationFrame to batch scroll-triggered DOM changes
      if (this.highlightingRAF) {
        cancelAnimationFrame(this.highlightingRAF)
      }
      this.highlightingRAF = requestAnimationFrame(() => {
        this.applyAndRepackAll()
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
    if (this.shrinkPollingRAF) {
      cancelAnimationFrame(this.shrinkPollingRAF)
      this.shrinkPollingRAF = null
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
      this.mutationObserver = null
    }
  }

  /**
   * Poll shrinkWrappersToFit on every animation frame until the measured
   * clip-wrapper height has been stable for several consecutive frames, or
   * until maxAttempts is reached.  This is necessary because ReactVirtualized
   * measures rows lazily over multiple frames, so a single one-shot call
   * captures only the rows that have been measured so far.
   */
  private startShrinkPolling(maxAttempts: number = 60): void {
    if (this.shrinkPollingRAF !== null) {
      cancelAnimationFrame(this.shrinkPollingRAF)
      this.shrinkPollingRAF = null
    }

    let attempts = 0
    let stableFrames = 0
    const STABLE_THRESHOLD = 5 // must be unchanged for this many consecutive frames

    // Record the clip-wrapper heights from the previous frame.
    const prevHeights = new Map<Element, number>()

    const poll = () => {
      shrinkWrappersToFit()

      // Check whether all clip-wrappers have stabilised.
      let allStable = true
      document
        .querySelectorAll('.folder-compare-view .diff-clip-wrapper')
        .forEach(cw => {
          const h = parseInt((cw as HTMLElement).style.height || '0', 10)
          if (h !== prevHeights.get(cw)) {
            allStable = false
            prevHeights.set(cw, h)
          }
        })

      attempts++
      if (allStable && prevHeights.size > 0) {
        stableFrames++
      } else {
        stableFrames = 0
      }

      if (stableFrames >= STABLE_THRESHOLD || attempts >= maxAttempts) {
        this.shrinkPollingRAF = null
        return
      }

      this.shrinkPollingRAF = requestAnimationFrame(poll)
    }

    this.shrinkPollingRAF = requestAnimationFrame(poll)
  }

  /**
   * Central entry point: applies component highlighting + repacking/shrinking.
   * Disconnects the MutationObserver during the operation to prevent recursive
   * DOM-mutation loops, then reconnects it afterwards.
   */
  private applyAndRepackAll(): void {
    if (this.isApplyingHighlighting) return
    this.isApplyingHighlighting = true

    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
    }

    try {
      applyComponentHighlightingToAll(
        this.state.fileChanges,
        this.state.diffComponents,
        this.state.selectedComponent,
        this.handleCharHighlightClick
      )

      if (this.state.selectedComponent === 'all') {
        // Kick off polling: ReactVirtualized may still be lazily adjusting
        // row heights after the file containers were unhidden, so a single
        // shrinkWrappersToFit call can capture stale values.
        this.startShrinkPolling()
      } else {
        for (const file of this.state.fileChanges) {
          const fc = document.querySelector(
            `.folder-compare-view [data-file-path="${file.path}"]`
          )
          if (fc) repackFile(fc)
        }
      }

      setupScrollSync()
    } finally {
      this.isApplyingHighlighting = false

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
    // Find file container by matching the end of the path (handles both full paths and basenames)
    const allContainers = document.querySelectorAll('.folder-compare-view [data-file-path]')
    for (const container of Array.from(allContainers)) {
      const filePath = (container as HTMLElement).dataset.filePath || ''
      if (filePath === fileName || filePath.endsWith('/' + fileName) || filePath.endsWith('\\' + fileName)) {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
    }
  }

  private scrollToLine(fileName: string, lineNum: number, side: 'before' | 'after'): void {
    // Find file container by matching the end of the path
    const allContainers = document.querySelectorAll('.folder-compare-view [data-file-path]')
    let fileContainer: Element | null = null
    for (const container of Array.from(allContainers)) {
      const filePath = (container as HTMLElement).dataset.filePath || ''
      if (filePath === fileName || filePath.endsWith('/' + fileName) || filePath.endsWith('\\' + fileName)) {
        fileContainer = container
        break
      }
    }
    
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
    const lineNumber = extractLineNumber(lineNumDiv)
    if (lineNumber === null) return

    const fileContainer = target.closest('[data-file-path]') as HTMLElement
    if (!fileContainer) return
    const filePath = fileContainer.dataset.filePath || ''

    if (this.state.selectedComponent === 'all') return
    const componentIndex = this.state.selectedComponent as number
    const component = this.state.diffComponents[componentIndex]
    if (!component) return

    const pos = `${lineNumber}:${startCol}-${endCol}`

    // Helper function to check if paths match
    const pathMatches = (jsonFile: string, fullPath: string): boolean => {
      return fullPath === jsonFile || fullPath.endsWith('/' + jsonFile) || fullPath.endsWith('\\' + jsonFile)
    }

    // Search edges for a matching from/to node at this position
    for (const change of component.changes) {
      if (change.from && pathMatches(change.from.file, filePath) && change.from.position === pos) {
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
      if (change.to && pathMatches(change.to.file, filePath) && change.to.position === pos) {
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

    // Find all edges involving this node and collect unique file:line combinations
    const uniqueLocations = new Map<string, {file: string, lineNum: number, side: 'before' | 'after'}>()
    
    for (const change of component.changes) {
      // Check if this edge involves the selected node
      let otherNode: any = null
      if (change.from && change.from.java_id === info.javaId && change.to) {
        otherNode = change.to
      } else if (change.to && change.to.java_id === info.javaId && change.from) {
        otherNode = change.from
      }
      
      if (otherNode && otherNode.position && otherNode.file) {
        const lineNum = parseInt(otherNode.position.split(':')[0], 10)
        if (!isNaN(lineNum)) {
          // Determine side based on edge kind
          const side: 'before' | 'after' = change.kind === 'Removal' ? 'before' : 'after'
          const key = `${otherNode.file}:${lineNum}:${side}`
          uniqueLocations.set(key, { file: otherNode.file, lineNum, side })
        }
      }
    }

    // Look up the node in diff_nodes.json for additional info
    //const nodeData = this.state.diffNodes.find((n: any) => n.component_id === component.component_id)
    //const diffNode = nodeData?.nodes?.find((n: any) => n.java_id === info.javaId)

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

        <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 600 }}>
          Related Changes ({uniqueLocations.size})
        </h4>

        {uniqueLocations.size === 0 && (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary-color)', fontStyle: 'italic' }}>
            No directly caused changes for this node
          </div>
        )}

        {Array.from(uniqueLocations.values()).map((loc, i) => {
          // Try to get content from the primary side first
          let lineContent = getSourceLineContent(loc.file, loc.lineNum, loc.side, this.state.fileDiffs)
          
          // If empty, try the opposite side as fallback (for modified lines where content exists on both sides)
          if (!lineContent || lineContent.trim() === '') {
            const oppositeSide = loc.side === 'before' ? 'after' : 'before'
            lineContent = getSourceLineContent(loc.file, loc.lineNum, oppositeSide, this.state.fileDiffs)
          }
          
          return (
            <div key={i} style={{
              fontSize: '11px',
              padding: '10px',
              marginBottom: '6px',
              backgroundColor: 'var(--background-color)',
              borderRadius: '4px',
              borderLeft: '3px solid var(--diff-selected-border-color)',
              cursor: 'pointer'
            }}
            onClick={() => {
              this.scrollToLine(loc.file, loc.lineNum, loc.side)
            }}
            >
              <div style={{ 
                marginBottom: '4px', 
                fontSize: '12px', 
                fontWeight: 600,
                color: 'var(--text-color)', 
                cursor: 'inherit',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {loc.file}
              </div>
              <div style={{ 
                fontFamily: 'var(--font-family-monospace)', 
                color: 'var(--text-color)', 
                cursor: 'inherit',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontSize: '12px'
              }}>
                <span style={{ color: 'var(--text-secondary-color)' }}>{loc.lineNum}:</span> {lineContent || '(empty line)'}
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
      const [fileChanges, { diffComponents, diffNodes }] = await Promise.all([
        compareDirectories(beforeFolder, afterFolder),
        loadDiffComponents(),
      ])

      this.setState({
        diffComponents,
        diffNodes,
        fileChanges,
        isLoading: false,
        isLoadingDiffs: true,
      })

      await loadAllDiffs(
        beforeFolder,
        afterFolder,
        fileChanges,
        diffs => this.setState({ fileDiffs: diffs })
      )

      this.setState({ isLoadingDiffs: false })
    } catch (error) {
      console.error('Error comparing folders:', error)
      this.setState({ isLoading: false, isLoadingDiffs: false })
    }
  }

  private onComponentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    this.setState({
      selectedComponent: value === 'all' ? 'all' : parseInt(value, 10),
      selectedNodeInfo: null,
    })
  }

  private toggleKindCollapse = (kind: string) => {
    this.setState(prevState => {
      const collapsed = [...prevState.collapsedKinds]
      const idx = collapsed.indexOf(kind)
      if (idx >= 0) {
        collapsed.splice(idx, 1)
      } else {
        collapsed.push(kind)
      }
      return { collapsedKinds: collapsed }
    })
  }

  private onChangeFolders = () => {
    this.diffHeightsAdjusted = false
    this.setState({
      showFolderSelector: true,
      fileChanges: [],
      fileDiffs: new Map(),
    })
  }
}
