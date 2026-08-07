import * as React from 'react'
import * as Path from 'path'
import * as FSPromises from 'fs/promises'
import { Button } from '../lib/button'
import { Dispatcher } from '../dispatcher'
import { FolderSelector } from './folder-selector'
import { WorkingDirectoryFileChange } from '../../models/status'
import { AppFileStatusKind } from '../../models/status'
import { ITextDiff, ImageDiffType, DiffLineType } from '../../models/diff'
import { Diff } from '../diff'
import { Repository } from '../../models/repository'
import { DiffSearchInput } from '../diff/diff-search-input'
import { showContextualMenu } from '../../lib/menu-item'
import { IFileContents } from '../diff/syntax-highlighting'
import { highlight } from '../../lib/highlighter/worker'
import { ITokens, ILineTokens } from '../../lib/highlighter/types'

// -- Helper modules ----------------------------------------------------------
import {
  applyComponentHighlightingToAll,
  extractLineNumber,
  getClaimedLineNumbers,
  getHighlightedLinesForComponent,
  injectExpandButtonsIntoHunkInfoRows,
  injectBoundaryExpandButtons,
  injectRenameHoverOverlays,
  removeRenameHoverOverlays,
} from './folder-compare-highlight'
import { repackFile, shrinkWrappersToFit, setupScrollSync, refreshScrollSync, scrollHorizontallyToElement } from './folder-compare-repack'
import {
  loadDiffComponents,
  loadAllDiffs,
  loadPrecomputedDiffs,
  compareDirectories,
  getSourceLineContent,
} from './folder-compare-data'

/** Connecting/keyword tokens in component names — rendered in the base font. */
const COMPONENT_NAME_CONNECTORS = new Set([
  'method', 'variable', 'parameter', 'field', 'type', 'import',
  'added', 'removed', 'renamed', 'from', 'to', 'in', 'of',
])

/** Render a component name with identifiers highlighted. */
function renderComponentName(name: string): React.ReactNode {
  const words = name.split(' ')
  const elements: React.ReactNode[] = []
  words.forEach((word, i) => {
    if (i > 0) elements.push(' ')
    if (COMPONENT_NAME_CONNECTORS.has(word.toLowerCase())) {
      elements.push(<span key={i}>{word}</span>)
    } else {
      elements.push(<span key={i} className="comp-name-ident">{word}</span>)
    }
  })
  return <>{elements}</>
}

interface FileTreeNode {
  name: string
  fullPath: string
  children: FileTreeNode[]
  filePaths: string[]
}

// ---------------------------------------------------------------------------
// Resizable panel constants (minimum sizes in pixels)
// ---------------------------------------------------------------------------
const MIN_LEFT_PANEL_WIDTH = 200
const MIN_MIDDLE_PANEL_WIDTH = 300
const MIN_RIGHT_PANEL_WIDTH = 200
const MIN_LEFT_TOP_HEIGHT = 100
const MIN_LEFT_BOTTOM_HEIGHT = 100
const DEFAULT_LEFT_PANEL_WIDTH = 350
const DEFAULT_RIGHT_PANEL_WIDTH = 350
/** Fraction of the left panel occupied by the top (options) section */
const DEFAULT_LEFT_TOP_FRACTION = 0.68

interface IFolderCompareViewProps {
  readonly dispatcher: Dispatcher
}

interface IFolderCompareViewState {
  readonly showFolderSelector: boolean
  readonly beforeFolder: string
  readonly afterFolder: string
  readonly diffmagicFolder: string
  readonly fileChanges: ReadonlyArray<WorkingDirectoryFileChange>
  readonly fileDiffs: Map<string, ITextDiff | null>
  readonly isLoading: boolean
  readonly isLoadingDiffs: boolean
  readonly diffComponents: any[]
  readonly diffNodes: any[]
  readonly selectedComponent: number | 'all' | 'misc'
  readonly selectedNodeInfo: {
    javaId: number
    type: string
    content: string
    position: string
    file: string
    componentIndex: number
  } | null
  readonly collapsedKinds: ReadonlyArray<string>
  readonly collapsedFolders: ReadonlyArray<string>
  readonly hunkEntries: Array<{fileName: string, beforeLine: number | null, afterLine: number | null}>
  readonly selectedRightPanelLine: string | null
  readonly leftPanelWidth: number
  readonly rightPanelWidth: number
  readonly leftTopFraction: number
  readonly isSearching: boolean
  readonly fileContentsMap: Map<string, IFileContents>
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
      diffmagicFolder: '',
      fileChanges: [],
      fileDiffs: new Map(),
      isLoading: false,
      isLoadingDiffs: false,
      diffComponents: [],
      diffNodes: [],
      selectedComponent: 'all',
      selectedNodeInfo: null,
      collapsedKinds: [],
      collapsedFolders: [],
      hunkEntries: [],
      selectedRightPanelLine: null,
      leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
      rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
      leftTopFraction: DEFAULT_LEFT_TOP_FRACTION,
      isSearching: false,
      fileContentsMap: new Map(),
    }
  }

  public render() {
    if (this.state.showFolderSelector) {
      return (
        <FolderSelector
          beforeFolder={this.state.beforeFolder}
          afterFolder={this.state.afterFolder}
          diffmagicFolder={this.state.diffmagicFolder}
          onDismissed={this.onFolderSelectorDismissed}
          onCompareFolders={this.onCompareFolders}
        />
      )
    }

    const hasLeftPanel = this.state.diffComponents.length > 0
    const hasRightPanel = this.state.selectedComponent !== 'all' && this.state.selectedComponent !== 'misc'
    const isComponentMode = hasRightPanel || this.state.selectedComponent === 'misc'

    return (
      <div className={`folder-compare-view${isComponentMode ? ' component-mode' : ''}`} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <style>{`
          .resize-handle-h {
            width: 4px;
            cursor: col-resize;
            flex-shrink: 0;
            background: transparent;
            transition: background-color 0.15s;
            position: relative;
            z-index: 20;
          }
          .resize-handle-h::before {
            content: '';
            position: absolute;
            top: 0;
            bottom: 0;
            left: -4px;
            right: -4px;
            cursor: col-resize;
          }
          .resize-handle-h:hover,
          .resize-handle-h.active {
            background-color: var(--diff-selected-border-color);
          }
          .resize-handle-v {
            height: 4px;
            cursor: row-resize;
            flex-shrink: 0;
            background-color: var(--background-color);
            transition: background-color 0.15s;
            position: relative;
            z-index: 20;
          }
          .resize-handle-v::before {
            content: '';
            position: absolute;
            left: 0;
            right: 0;
            top: -4px;
            bottom: -4px;
            cursor: row-resize;
          }
          .resize-handle-v:hover,
          .resize-handle-v.active {
            background-color: var(--diff-selected-border-color);
          }
        `}</style>
        <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
          {/* Left Sidebar for Component Selection */}
          {hasLeftPanel && (
            <div className="component-selector-sidebar" style={{
              width: `${this.state.leftPanelWidth}px`,
              minWidth: `${MIN_LEFT_PANEL_WIDTH}px`,
              backgroundColor: 'var(--box-alt-background-color)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
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
                .component-selector-sidebar ::-webkit-scrollbar-corner {
                  background: transparent;
                }
                .sidebar-file-entry,
                .sidebar-file-entry * {
                  cursor: pointer !important;
                }
                .comp-name-ident {
                  color: var(--text-color);
                  background-color: rgba(127, 127, 127, 0.15);
                  border-radius: 3px;
                  padding: 0 3px;
                  font-weight: 600;
                }
              `}</style>
              {/* Scrollable top section: component list */}
              <div style={{ flex: `0 0 ${this.state.leftTopFraction * 100}%`, display: 'flex', flexDirection: 'column', padding: '15px', minHeight: `${MIN_LEFT_TOP_HEIGHT}px`, overflow: 'hidden' }}>
              <h3 style={{ margin: '0 0 15px 0', fontSize: 'var(--font-size-md)', fontWeight: 600 }}>Diff View Options</h3>
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
                  <span style={{ fontSize: 'var(--font-size)' }}>Show All<br></br></span>
                </label>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, marginTop: '6px' }}>
                <div style={{ flex: 1, overflow: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
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

                  const orderedKinds = Array.from(kindGroups.entries())
                    .map(([kind, items]) => ({
                      kind,
                      items,
                      largestBatchSize: items.reduce(
                        (largest, item) => Math.max(largest, item.comp.changes?.length || 0),
                        0
                      ),
                    }))
                    .sort((a, b) => {
                      const sizeDelta = b.largestBatchSize - a.largestBatchSize
                      if (sizeDelta !== 0) {
                        return sizeDelta
                      }
                      return (kindLabels[a.kind] || a.kind).localeCompare(kindLabels[b.kind] || b.kind)
                    })

                  return orderedKinds.map(({ kind, items }) => {
                    items.sort((a, b) => {
                      const sizeDelta = (b.comp.changes?.length || 0) - (a.comp.changes?.length || 0)
                      if (sizeDelta !== 0) {
                        return sizeDelta
                      }
                      return (a.comp.component_name || '').localeCompare(b.comp.component_name || '')
                    })
                    const isCollapsed = this.state.collapsedKinds.includes(kind)
                    const label = kindLabels[kind] || kind.charAt(0).toUpperCase() + kind.slice(1) + 's'
                    return (
                      <div key={kind}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            cursor: 'pointer',
                            padding: '8px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--box-border-color)',
                            fontSize: 'var(--font-size)',
                            fontWeight: 600,
                            userSelect: 'none',
                            position: 'sticky',
                            top: 0,
                            zIndex: 10,
                          }}
                          onClick={() => this.toggleKindCollapse(kind)}
                        >
                          <span style={{ fontSize: 'var(--font-size-xs)', display: 'inline-block', transition: 'transform 0.15s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>&#9660;</span>
                          <span>{label}</span>
                          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary-color)', marginLeft: 'auto' }}>({items.length})</span>
                        </div>
                        {!isCollapsed && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px', marginLeft: '8px' }}>
                            {items.map(({ comp, index }) => {
                              const isSelected = this.state.selectedComponent === index
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
                                    <span style={{ fontSize: 'var(--font-size)', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{comp.component_name ? renderComponentName(comp.component_name) : `Component ${comp.component_id}`}</span>
                                  </label>
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
                <div style={{
                  flexShrink: 0,
                  paddingTop: '14px',
                  backgroundColor: 'var(--box-alt-background-color)',
                }}>
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '8px',
                      borderRadius: '4px',
                      backgroundColor: this.state.selectedComponent === 'misc' ? 'var(--box-border-color)' : 'var(--background-color)'
                    }}>
                      <input
                        type="radio"
                        name="component-view"
                        value="misc"
                        checked={this.state.selectedComponent === 'misc'}
                        onChange={this.onComponentChange}
                      />
                      <span style={{ fontSize: 'var(--font-size)' }}>Miscellaneous</span>
                    </label>
                </div>
                </div>
              </div>
              {/* Vertical resize handle between top and bottom of left panel */}
              <div
                className={`resize-handle-v${this.draggingHandle === 'left-v' ? ' active' : ''}`}
                onMouseDown={this.onLeftVerticalResizeStart}
              />
              {/* File list at bottom */}
              <div style={{
                padding: '12px 15px',
                flex: 1,
                minHeight: `${MIN_LEFT_BOTTOM_HEIGHT}px`,
                overflow: 'auto'
              }}>
                <h3 style={{ margin: '0 0 15px 0', fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
                  Files
                </h3>
                {this.renderFileTree(this.getRelevantFiles())}
              </div>
            </div>
          )}

          {/* Horizontal resize handle: left ↔ middle */}
          {hasLeftPanel && (
            <div
              className={`resize-handle-h${this.draggingHandle === 'left-h' ? ' active' : ''}`}
              onMouseDown={this.onLeftHorizontalResizeStart}
            />
          )}

          {/* Main Content Area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: `${MIN_MIDDLE_PANEL_WIDTH}px` }}>
            <div className="folder-compare-header" style={{ padding: '10px', borderBottom: '1px solid var(--box-border-color)', backgroundColor: 'var(--box-background-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <Button onClick={this.onChangeFolders}>Change Folders</Button>
                {this.state.fileChanges.length > 0 && (
                  <span style={{ fontSize: 'var(--font-size)', color: 'var(--text-secondary-color)' }}>
                    {this.state.fileChanges.length} changed {this.state.fileChanges.length === 1 ? 'file' : 'files'}
                  </span>
                )}
              </div>
            </div>

            {this.state.isSearching && (
              <div className="folder-search-bar-wrapper" style={{
                padding: '6px 10px',
                borderBottom: '1px solid var(--box-border-color)',
                backgroundColor: 'var(--box-background-color)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}>
                <DiffSearchInput
                  onSearch={this.onFolderSearch}
                  onClose={this.closeFolderSearch}
                />
                <span
                  ref={this.searchCountRef}
                  style={{ fontSize: 'var(--font-size)', color: 'var(--text-secondary-color)', whiteSpace: 'nowrap' }}
                />
              </div>
            )}
        
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
                    borderTopRightRadius: '6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3 style={{
                        margin: '0 0 5px 0',
                        fontSize: 'var(--font-size-md)',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        direction: 'rtl',
                        textAlign: 'left',
                      }}>
                        <span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{file.path}</span>
                      </h3>
                      <div style={{ fontSize: 'var(--font-size)', color: 'var(--text-secondary-color)' }}>
                        {this.getStatusLabel(file.status.kind)}
                      </div>
                    </div>
                    {this.renderDiffStats(file.id, file.path)}
                  </div>
                  
                  <div className="diff-container" style={{ 
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

          {/* Horizontal resize handle: middle ↔ right */}
          {hasRightPanel && (
            <div
              className={`resize-handle-h${this.draggingHandle === 'right-h' ? ' active' : ''}`}
              onMouseDown={this.onRightHorizontalResizeStart}
            />
          )}

          {/* Right Panel for Changed Lines */}
          {this.renderRightPanel()}
        </div>
      </div>
    )
  }

  private getDummyRepository(): Repository {
    // Use the memoised version so the reference is stable across renders
    return this.getStableRepository()
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
          fileContents={this.state.fileContentsMap.get(file.id) ?? null}
          imageDiffType={ImageDiffType.TwoUp}
          hideWhitespaceInDiff={false}
          showSideBySideDiff={true}
          showDiffCheckMarks={false}
          onOpenBinaryFile={this.noopHandler}
          onChangeImageDiffType={this.noopHandler}
          onHideWhitespaceInDiffChanged={this.noopHandler}
        />
        <style>{`
          /* CSS Variables for filtered line opacity - adjust these to change faintness */
          :root {
            --filtered-line-opacity: 0.04;
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

          /* Override global cursor:default on right-panel entry boxes */
          .right-panel-entry,
          .right-panel-entry * {
            cursor: pointer !important;
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
            color: inherit !important;
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

          /* In component mode, force ALL dividers gray — no blue anywhere */
          .folder-compare-view.component-mode .hunk-handle-place-holder,
          .folder-compare-view.component-mode .hunk-handle-place-holder.selected,
          .folder-compare-view.component-mode .row.added .hunk-handle-place-holder,
          .folder-compare-view.component-mode .row.deleted .hunk-handle-place-holder,
          .folder-compare-view.component-mode .row.modified .hunk-handle-place-holder {
            background-color: var(--diff-empty-hunk-handle) !important;
          }
          .folder-compare-view.component-mode .hunk-handle,
          .folder-compare-view.component-mode .hunk-handle.selected {
            background-color: var(--diff-empty-hunk-handle) !important;
          }

          /* Filtered changed rows (not in the current component) get the
             darker gray divider, matching unchanged/context lines */
          .folder-compare-view.component-mode .component-filtered .hunk-handle-place-holder,
          .folder-compare-view.component-mode .component-filtered.added .hunk-handle-place-holder,
          .folder-compare-view.component-mode .component-filtered.deleted .hunk-handle-place-holder,
          .folder-compare-view.component-mode .component-filtered.modified .hunk-handle-place-holder {
            background-color: var(--diff-border-color) !important;
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
          /* Text color for characters sitting on top of a bright highlight
             – uses the theme-aware diff text variable so it works in both modes */
          .folder-compare-view .component-char-white {
            color: var(--diff-text-color) !important;
          }

          /* content-wrapper stacking context is created in addCharHighlights
             (position:relative + z-index:0).  With the overlay at z-index:-1
             all normal-flow text—including bare text nodes—renders on top. */

          /* Content doesn't wrap; overflow hidden prevents per-line scrolling.
             Programmatic scrollLeft still works with overflow:hidden.
             IMPORTANT: .content must NOT be position:relative/z-index — that
             would give it its own stacking context which can cover the
             adjacent .line-number despite the latter having a higher z-index
             (the two flex siblings don't overlap in layout, but sub-pixel
             rendering and background painting can make the line-number text
             look clipped at the boundary).  Keeping .content static lets
             .line-number (positioned, z-index:5) always paint on top. */
          .folder-compare-view .content {
            white-space: pre !important;
            word-break: normal !important;
            overflow: hidden !important;
          }
          .folder-compare-view .content-wrapper {
            white-space: pre !important;
          }
          /* Line numbers must paint above content — use high z-index with
             !important so no SCSS or RV inline style can override it.
             Remove border so every row's .line-number occupies the exact
             same space regardless of row type (the SCSS applies a border
             on selectable/changed rows but not context rows, causing a
             2px width discrepancy when box-sizing is border-box). */
          .folder-compare-view .line-number {
            position: relative !important;
            z-index: 5 !important;
            overflow: visible !important;
            box-sizing: border-box !important;
            border: none !important;
          }
          /* Selectable (changed) rows are ~2px narrower than context rows.
             Paint a gutter-coloured strip at the outer edge using a
             pseudo-element, and shift the number text to match context rows. */
          .folder-compare-view .before .line-number.selectable::before {
            content: '';
            position: absolute;
            left: -2px;
            top: 0;
            bottom: 0;
            width: 2px;
            background-color: inherit;
          }
          .folder-compare-view .after .line-number.selectable::after {
            content: '';
            position: absolute;
            right: -2px;
            top: 0;
            bottom: 0;
            width: 2px;
            background-color: inherit;
          }
          /* Nudge the number text to align with context rows */
          .folder-compare-view .before .line-number.selectable label > span {
            transform: translateX(-2px);
          }
          .folder-compare-view .after .line-number.selectable label > span {
            transform: translateX(2px);
          }
          /* sr-only spans (" deleted", " added", "Line ") inside line-number
             labels must be fully hidden from layout so they don't shift the
             visible number text towards the center. */
          .folder-compare-view .line-number .sr-only {
            position: absolute !important;
            width: 1px !important;
            height: 1px !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: hidden !important;
            clip: rect(0, 0, 0, 0) !important;
            clip-path: inset(100%) !important;
            white-space: nowrap !important;
            border: 0 !important;
            top: 0 !important;
            left: 0 !important;
          }

          /* Search marks must be visible on top of ANY diff highlighting */
          .folder-compare-view .folder-search-mark {
            background-color: rgba(255, 166, 0, 0.5) !important;
            color: #000 !important;
            position: relative !important;
            z-index: 10 !important;
            border-radius: 2px;
            box-shadow: 0 0 0 1px rgba(0,0,0,0.3);
          }
          .folder-compare-view .folder-search-current {
            background-color: rgba(100, 180, 255, 0.7) !important;
          }
          /* Wider vertical scrollbar for the middle (code) panel.
             Must use !important to override the global win32/linux
             ::-webkit-scrollbar rules in _scroll.scss. */
          .folder-compare-content::-webkit-scrollbar {
            width: 10px !important;
            background: transparent !important;
          }
          .folder-compare-content::-webkit-scrollbar-thumb {
            background-color: var(--scroll-bar-thumb-background-color) !important;
            border-radius: 10px !important;
            border: 2px solid transparent !important;
            background-clip: padding-box !important;
          }
          .folder-compare-content::-webkit-scrollbar-thumb:hover,
          .folder-compare-content::-webkit-scrollbar-thumb:active {
            border-width: 1px !important;
            background-color: var(--scroll-bar-thumb-background-color-active) !important;
          }
          .folder-compare-content::-webkit-scrollbar-track {
            background: rgba(127, 127, 127, 0.12) !important;
            border-radius: 10px !important;
          }
          /* Clip box-shadow from sticky scrollbar so it doesn't bleed
             into the gap between files.  overflow:clip does NOT create
             a scroll container, so sticky positioning still works. */
          .folder-compare-view [data-file-path] {
            overflow: clip;
          }
          /* Space between visible file containers — the first visible
             (non-hidden) file gets no top margin so all components start
             at the same position regardless of which files are hidden. */
          .folder-compare-content > div > [data-file-path]:not(.component-file-hidden) ~ [data-file-path]:not(.component-file-hidden) {
            margin-top: 20px;
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
            top: -99999px !important;
          }

          /* Packed visible rows: CSS custom property overrides RV's inline top */
          .folder-compare-view .component-packed {
            top: var(--packed-top) !important;
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

          /* ── Expand-context button on hunk separators / hunk-info rows ── */
          .folder-compare-view .hunk-expansion-handle {
            /* Override SCSS button styles so the handle and button are the
               same size and the entire area is clickable. */
            height: 20px !important;
            box-sizing: border-box !important;
            padding: 0 !important;
            cursor: pointer;
          }
          .folder-compare-view .hunk-expansion-handle button {
            width: 100% !important;
            height: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          /* Force hunk-info rows to exactly 20px so they match normal rows.
             z-index above hunk-handle (10) so the @@ header covers dividers. */
          .folder-compare-view .hunk-info.row {
            height: 20px !important;
            line-height: 20px !important;
            position: relative !important;
            z-index: 11 !important;
          }
          /* Separators carry .hunk-info.row but must stay absolutely-positioned
             so repackFile's top values work correctly.  This selector (4 classes)
             beats the generic .hunk-info.row rule (3 classes) above. */
          .folder-compare-view .component-hunk-separator.hunk-info.row {
            position: absolute !important;
          }
          .folder-compare-view .expand-context-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            border: none;
            background: transparent;
            color: var(--diff-hunk-text-color);
            cursor: pointer;
            padding: 0;
            margin: 0;
          }
          .folder-compare-view .expand-context-btn:hover {
            background: transparent;
          }
          .folder-compare-view .hunk-expansion-handle:hover {
            background: rgba(27, 125, 237, 0.85) !important;
          }
          .folder-compare-view .expand-context-icon {
            pointer-events: none;
          }
          /* In "Show All" hunk-info the expansion handle already has the
             right background; just make the button fill it fully. */
          .folder-compare-view .hunk-info:not(.component-hunk-separator) .expand-context-btn {
            width: 100%;
            height: 100%;
          }

          /* Expanded context rows inserted by expand-hunk-context handler */
          .folder-compare-view .expanded-context-row {
            position: absolute;
            width: 100%;
          }
          .folder-compare-view .expanded-context-row .row {
            display: flex;
            flex-direction: row;
            line-height: 20px;
            height: 100%;
          }
          .folder-compare-view .expanded-context-row .before,
          .folder-compare-view .expanded-context-row .after {
            width: 50%;
            display: flex;
            background: var(--diff-background-color);
            color: var(--diff-text-color);
          }
          .folder-compare-view .expanded-context-row .line-number {
            flex-shrink: 0;
            background: var(--diff-gutter-background-color);
            color: var(--diff-line-number-color);
            display: flex;
            box-sizing: content-box;
            position: relative;
            z-index: 2;
            align-items: center;
            justify-content: center;
          }
          .folder-compare-view .expanded-context-row .line-number label {
            width: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            font-variant-numeric: tabular-nums;
          }
          .folder-compare-view .expanded-context-row .content {
            white-space: pre !important;
            word-break: normal !important;
            overflow: hidden !important;
            position: relative;
            z-index: 1;
            flex: 1;
            display: flex;
          }
          .folder-compare-view .expanded-context-row .prefix {
            user-select: none;
            white-space: nowrap;
          }
          .folder-compare-view .expanded-context-row .content-wrapper {
            white-space: pre !important;
            flex: 1;
          }

          /* ── Expanded hunk-info (hidden after user clicks expand) ── */
          .folder-compare-view .hunk-expanded {
            top: -99999px !important;
            visibility: hidden !important;
          }

          /* ── Override RV inner container overflow so injected elements
               (boundary expand buttons, etc.) are visible even when RV
               resets the container height.  Clipping is handled by
               diff-clip-wrapper instead. ── */
          .folder-compare-view .ReactVirtualized__Grid__innerScrollContainer {
            overflow: visible !important;
          }

          /* ── Bottom boundary expand button (now uses standard hunk-info structure) ── */
          .folder-compare-view .expand-boundary-bottom {
            position: absolute;
            width: 100%;
          }

          /* ── "Show All" hunk-info rows: hide the original React-rendered
               content-wrapper since injectExpandButtonsIntoHunkInfoRows
               replaces it with two @@-content divs matching the separator
               structure. For rows not yet injected, keep them invisible. ── */
          .folder-compare-view .hunk-info:not(.component-hunk-separator) .content {
            display: flex;
            align-items: center;
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
            margin-top: 0 !important;
            margin-bottom: 0 !important;
            padding: 0 !important;
            border: none !important;
          }

          /* ── Rename hover overlays ── */
          .rename-hover-overlay {
            /* transparent overlay; just captures hover */
            background: transparent;
          }
          .rename-hover-overlay:hover {
            background: rgba(27, 125, 237, 0.10);
          }
          .rename-hover-tooltip {
            position: fixed;
            z-index: 10000;
            width: 220px;
            padding: 10px 12px;
            border-radius: 6px;
            background-color: var(--box-background-color, #1e1e1e);
            border: 1px solid var(--box-border-color, #444);
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            font-size: var(--font-size, 12px);
            color: var(--text-color, #ccc);
            pointer-events: auto;
          }
          .rename-hover-tooltip-name {
            margin-bottom: 6px;
            font-weight: 600;
            line-height: 1.3;
            color: var(--text-color, #eee);
          }
          .rename-hover-tooltip-link {
            color: #1b7ded;
            cursor: pointer;
            font-size: var(--font-size-sm, 11px);
            text-decoration: underline;
          }
          .rename-hover-tooltip-link:hover {
            color: #4da3ff;
          }

          /* Context lines within a component addition span (green) */
          .folder-compare-view .component-context-addition {
            background: var(--diff-add-background-color) !important;
          }
          .folder-compare-view .component-context-addition .line-number {
            background-color: var(--diff-add-background-color) !important;
          }
          /* Context lines within a component deletion span (red) */
          .folder-compare-view .component-context-deletion {
            background: var(--diff-delete-background-color) !important;
          }
          .folder-compare-view .component-context-deletion .line-number {
            background-color: var(--diff-delete-background-color) !important;
          }
          /* Auto-expanded rows for component lines in inter-hunk gaps */
          .folder-compare-view .component-auto-expanded .component-context-addition .content,
          .folder-compare-view .component-auto-expanded .component-context-addition .content-wrapper {
            color: var(--diff-text-color) !important;
          }


        `}</style>
      </div>
      </div>
    )
  }

  private mutationObserver: MutationObserver | null = null
  private isApplyingHighlighting = false
  private highlightingRAF: number | null = null
  private renameOverlayRAF: number | null = null
  private diffHeightsAdjusted = false
  private shrinkPollingRAF: number | null = null

  // Observer suspension: nested suspend/resume pairs keep the observer
  // disconnected until ALL callers have resumed.
  private _observerSuspendCount = 0

  private suspendObserver(): void {
    if (this._observerSuspendCount === 0 && this.mutationObserver) {
      this.mutationObserver.disconnect()
    }
    this._observerSuspendCount++
  }

  private resumeObserver(): void {
    this._observerSuspendCount--
    if (this._observerSuspendCount <= 0) {
      this._observerSuspendCount = 0
      if (this.mutationObserver) {
        const container = document.querySelector('.folder-compare-view')
        if (container) {
          this.mutationObserver.observe(container, { childList: true, subtree: true })
        }
      }
    }
  }

  // -- Memoised Diff props (prevent unnecessary <Diff> re-renders) ----------
  private cachedRepository: Repository | null = null
  private cachedBeforeFolder = ''
  private readonly noopHandler = () => {}

  private getStableRepository(): Repository {
    if (
      !this.cachedRepository ||
      this.cachedBeforeFolder !== (this.state.beforeFolder || '')
    ) {
      this.cachedBeforeFolder = this.state.beforeFolder || ''
      this.cachedRepository = {
        id: 0,
        path: this.cachedBeforeFolder,
        name: 'Folder Comparison',
        missing: false,
        hash: 'folder-compare-temp',
      } as Repository
    }
    return this.cachedRepository
  }

  // -- Folder-level search state --------------------------------------------
  private folderSearchMatches: Array<{ row: HTMLElement; side: 'before' | 'after'; occurrence: number }> = []
  private folderSearchIndex = -1
  private folderSearchQuery = ''
  private searchCountRef = React.createRef<HTMLSpanElement>()

  public componentDidMount(): void {
    // Intercept find-text (capture phase) so individual SideBySideDiff
    // instances inside each <Diff> never see the event.
    document.addEventListener('find-text', this.onFolderFindText, true)
    window.addEventListener('keydown', this.onFolderKeyDown, true)
    window.addEventListener('resize', this.onWindowResize)
    document.addEventListener('expand-hunk-context', this.onExpandHunkContext as unknown as EventListener, true)
    document.addEventListener('select-rename-component', this.onSelectRenameComponent as unknown as EventListener, true)
  }

  public componentDidUpdate(prevProps: IFolderCompareViewProps, prevState: IFolderCompareViewState): void {
    // Apply highlighting when component selection changes
    if (prevState.selectedComponent !== this.state.selectedComponent) {
      // Reset scroll positions of middle and right panels to the top
      const middlePanel = document.querySelector('.folder-compare-content') as HTMLElement | null
      if (middlePanel) middlePanel.scrollTop = 0
      const rightPanel = document.querySelector('.right-panel') as HTMLElement | null
      if (rightPanel) rightPanel.scrollTop = 0

      // Cancel any ongoing shrink-polling so it doesn't overwrite our
      // repacked heights.  Run one final shrinkWrappersToFit synchronously
      // to ensure clip-wrappers have correct baseline heights before we
      // repack for the selected component.
      if (this.shrinkPollingRAF !== null) {
        cancelAnimationFrame(this.shrinkPollingRAF)
        this.shrinkPollingRAF = null
      }
      if (this.state.selectedComponent !== 'all') {
        shrinkWrappersToFit()
      }
      // componentDidUpdate fires after React has committed DOM changes,
      // so a single animation frame is enough for the browser to settle.
      // We schedule a follow-up repack in the next frame because the
      // first switch from "Show All" to a component can cause a layout
      // shift (right-panel appearing) that triggers ReactVirtualized to
      // re-render rows AFTER the initial repack.  The second pass
      // re-packs those late rows so the diff content is never blank.
      requestAnimationFrame(async () => {
        // Cancel any stale MutationObserver rAF so it cannot fire
        // during the await below and undo our inserted rows.
        if (this.highlightingRAF) {
          cancelAnimationFrame(this.highlightingRAF)
          this.highlightingRAF = null
        }

        this.applyAndRepackAll()
        // Insert any component lines that fall in inter-hunk gaps.
        // Keep the observer suspended until repackFile finishes so
        // the MutationObserver cannot re-trigger applyAndRepackAll
        // and strip the rows we just inserted.
        const needsInsert = this.state.selectedComponent !== 'all' && this.state.selectedComponent !== 'misc'
        if (needsInsert) {
          this.suspendObserver()
          try {
            await this.insertMissingComponentLines()
          } catch {
            // best-effort
          }
        }
        requestAnimationFrame(() => {
          if (this.state.selectedComponent !== 'all') {
            for (const file of this.state.fileChanges) {
              const fc = document.querySelector(
                `.folder-compare-view [data-file-path="${file.path}"]`
              )
              if (fc && !fc.classList.contains('component-file-hidden')) {
                repackFile(fc)
              }
            }
          }
          // Resume the observer only after repackFile has finished
          if (needsInsert) {
            this.resumeObserver()
          }
        })
      })
    }

    // Set up MutationObserver when diff content first appears
    if (!this.mutationObserver && !this.state.showFolderSelector && this.state.fileChanges.length > 0 && !this.state.isLoadingDiffs) {
      this.setupMutationObserver()
    }

    // When the search bar opens or closes the content area height changes;
    // re-shrink wrappers so no extra space appears.
    // In component/misc mode we must re-run repackFile instead of just
    // shrinkWrappersToFit, because ReactVirtualized may re-render in
    // response to a width change (e.g. scrollbar appearing) and overwrite
    // the packed inline `top` values we set on hidden rows.
    if (prevState.isSearching !== this.state.isSearching) {
      requestAnimationFrame(() => {
        if (this.state.selectedComponent !== 'all') {
          for (const file of this.state.fileChanges) {
            const fc = document.querySelector(
              `.folder-compare-view [data-file-path="${file.path}"]`
            )
            if (fc && !fc.classList.contains('component-file-hidden')) {
              repackFile(fc)
            }
          }
        } else {
          shrinkWrappersToFit()
        }
      })
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
        // Inject expand buttons into "Show All" hunk-info rows
        injectExpandButtonsIntoHunkInfoRows()
        // Inject boundary expand buttons at bottom of each file
        injectBoundaryExpandButtons(this.state.beforeFolder, this.state.afterFolder)
        // Inject rename hover overlays for the "Show All" view
        injectRenameHoverOverlays(this.state.diffComponents, this.state.diffNodes)
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
    document.removeEventListener('find-text', this.onFolderFindText, true)
    window.removeEventListener('keydown', this.onFolderKeyDown, true)
    window.removeEventListener('resize', this.onWindowResize)
    document.removeEventListener('expand-hunk-context', this.onExpandHunkContext as unknown as EventListener, true)
    document.removeEventListener('select-rename-component', this.onSelectRenameComponent as unknown as EventListener, true)
    removeRenameHoverOverlays()
    this.clearSearchHighlight()
  }

  private setupMutationObserver(): void {
    this.cleanupMutationObserver()

    this.mutationObserver = new MutationObserver((mutations) => {
      if (this.isApplyingHighlighting) return

      if (this.state.selectedComponent === 'all') {
        // In "Show All" mode, re-inject rename hover overlays when new rows
        // appear (e.g. ReactVirtualized lazily rendering more rows on scroll).
        const hasNewRows = mutations.some(m =>
          Array.from(m.addedNodes).some(n => {
            const el = n as Element
            return (
              el.nodeType === Node.ELEMENT_NODE &&
              typeof el.classList !== 'undefined' &&
              !el.classList.contains('rename-hover-overlay') &&
              !el.classList.contains('rename-hover-tooltip') &&
              (el.classList.contains('row') ||
               el.querySelector?.('.row') !== null)
            )
          })
        )
        if (hasNewRows && this.state.diffComponents.length > 0) {
          if (this.renameOverlayRAF) cancelAnimationFrame(this.renameOverlayRAF)
          this.renameOverlayRAF = requestAnimationFrame(() => {
            injectRenameHoverOverlays(this.state.diffComponents, this.state.diffNodes)
            this.renameOverlayRAF = null
          })
        }
        return
      }

      // Ignore mutations that consist *only* of our own separator
      // insertions/removals (class names starting with 'component-').
      // Those are produced by applyComponentHighlightingForFile and must not
      // re-trigger another highlighting pass, which would cause an infinite
      // re-apply loop and visual instability.
      const hasExternalMutations = mutations.some(m => {
        const isOurNode = (n: Node): boolean => {
          const el = n as Element
          if (typeof el.classList !== 'undefined' &&
            (el.classList.contains('component-hunk-separator') ||
             el.classList.contains('component-char-highlight') ||
             el.classList.contains('component-char-click-capture') ||
             el.classList.contains('component-char-white') ||
             el.classList.contains('folder-search-mark') ||
             el.classList.contains('expand-context-btn') ||
             el.classList.contains('expand-context-icon') ||
             el.classList.contains('expanded-context-row') ||
             el.classList.contains('expand-boundary-bottom') ||
             el.classList.contains('folder-search-bar-wrapper') ||
             el.classList.contains('rename-hover-overlay') ||
             el.classList.contains('rename-hover-tooltip')))
            return true
          // Nodes inside the search bar wrapper are ours too
          if ((n as Element).closest?.('.folder-search-bar-wrapper')) return true
          // Text nodes created/removed by search mark insertion/removal
          // (may be inside cm-* syntax spans nested within content-wrapper)
          if (n.nodeType === Node.TEXT_NODE) {
            const p = n.parentElement
            if (p && (p.classList.contains('content-wrapper') || p.closest?.('.content-wrapper'))) return true
          }
          return false
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
    if (this.renameOverlayRAF) {
      cancelAnimationFrame(this.renameOverlayRAF)
      this.renameOverlayRAF = null
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
        this.handleCharHighlightClick,
        this.state.diffNodes
      )

      if (this.state.selectedComponent === 'all') {
        // Kick off polling: ReactVirtualized may still be lazily adjusting
        // row heights after the file containers were unhidden, so a single
        // shrinkWrappersToFit call can capture stale values.
        this.startShrinkPolling()
        // Re-inject expand buttons into restored hunk-info rows
        injectExpandButtonsIntoHunkInfoRows()
        // Re-inject boundary expand buttons at bottom of each file
        injectBoundaryExpandButtons(this.state.beforeFolder, this.state.afterFolder)
        // Inject rename hover overlays on both sides of renamed identifiers
        injectRenameHoverOverlays(this.state.diffComponents, this.state.diffNodes)
      } else {
        // Remove rename hover overlays when switching away from "Show All"
        removeRenameHoverOverlays()
        for (const file of this.state.fileChanges) {
          const fc = document.querySelector(
            `.folder-compare-view [data-file-path="${file.path}"]`
          )
          if (fc) repackFile(fc)
        }
        // Inject boundary expand buttons at bottom of each file (component mode only)
        injectBoundaryExpandButtons(this.state.beforeFolder, this.state.afterFolder)
      }

      setupScrollSync()

      // Extract hunk entries from DOM for the left panel
      if (this.state.selectedComponent !== 'all') {
        const entries = this.extractHunkEntriesFromDOM()
        this.setState({ hunkEntries: entries })
      }
    } finally {
      this.isApplyingHighlighting = false

      // Only reconnect the observer if nothing else has it suspended.
      // This prevents undoing the suspend that insertMissingComponentLines
      // relies on to keep its inserted rows alive.
      if (this._observerSuspendCount <= 0 && this.mutationObserver) {
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

  /**
   * Return the list of file paths relevant to the current selection.
   * "Show All" → all fileChanges; component → only files touched by that component.
   */
  private getRelevantFiles(): string[] {
    if (this.state.selectedComponent === 'all' || this.state.selectedComponent === 'misc') {
      return this.state.fileChanges.map(f => f.path)
    }
    const componentIndex = this.state.selectedComponent as number
    const component = this.state.diffComponents[componentIndex]
    if (!component || !component.changes) return []

    const pathMatches = (jsonFile: string, fullPath: string): boolean =>
      fullPath === jsonFile ||
      fullPath.endsWith('/' + jsonFile) ||
      fullPath.endsWith('\\' + jsonFile)

    const matchedPaths = new Set<string>()
    for (const change of component.changes) {
      const files: string[] = []
      if (change.from?.file) files.push(change.from.file)
      if (change.to?.file) files.push(change.to.file)
      for (const jsonFile of files) {
        for (const fc of this.state.fileChanges) {
          if (pathMatches(jsonFile, fc.path)) {
            matchedPaths.add(fc.path)
          }
        }
      }
    }
    return Array.from(matchedPaths)
  }

  private scrollToFile(fileName: string): void {
    // Find file container by matching the end of the path (handles both full paths and basenames)
    const allContainers = document.querySelectorAll('.folder-compare-view [data-file-path]')
    for (const container of Array.from(allContainers)) {
      const filePath = (container as HTMLElement).dataset.filePath || ''
      if (filePath === fileName || filePath.endsWith('/' + fileName) || filePath.endsWith('\\' + fileName)) {
        this.scrollIntoViewIfNeeded(container, 'start')
        return
      }
    }
  }

  /**
   * Scroll to an element only if it is not already visible within the
   * `.folder-compare-content` scroll container.
   *
   * IMPORTANT: We must NOT use `el.scrollIntoView()` because it scrolls
   * every scrollable ancestor — including the ReactVirtualized Grid
   * container inside each diff.  That shifts content within the
   * `diff-clip-wrapper` and creates empty space at the bottom.
   * Instead we manually adjust only the `.folder-compare-content` scrollTop.
   */
  private scrollIntoViewIfNeeded(el: Element, block: ScrollLogicalPosition = 'center'): void {
    const scrollContainer = document.querySelector('.folder-compare-content') as HTMLElement | null
    if (!scrollContainer) {
      // Absolute fallback — should never happen in practice
      el.scrollIntoView({ behavior: 'smooth', block })
      return
    }
    const containerRect = scrollContainer.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    // Use clientHeight (excludes browser scrollbar) and also subtract the
    // height of any sticky scroll-sync-bar that overlaps the last row(s).
    const stickyBar = scrollContainer.querySelector('.scroll-sync-bar') as HTMLElement | null
    const stickyHeight = stickyBar ? stickyBar.getBoundingClientRect().height : 0
    const visibleBottom = containerRect.top + scrollContainer.clientHeight - stickyHeight

    // Account for sticky file headers that cover the top of the viewport.
    // Each file container has a sticky header (first child) that sticks at
    // the top when the user scrolls through that file.  An element behind
    // the header is technically in the container bounds but not visible.
    let stickyHeaderOffset = 0
    const fileContainer = el.closest('[data-file-path]') as HTMLElement | null
    if (fileContainer) {
      const header = fileContainer.children[0] as HTMLElement | null
      if (header) {
        const hRect = header.getBoundingClientRect()
        if (hRect.bottom > containerRect.top) {
          stickyHeaderOffset = Math.max(0, hRect.bottom - containerRect.top)
        }
      }
    }
    const visibleTop = containerRect.top + stickyHeaderOffset

    const isVisible =
      elRect.top >= visibleTop &&
      elRect.bottom <= visibleBottom
    if (isVisible) return

    // Compute the desired scrollTop so only the outer container moves.
    const elTopRelative = elRect.top - containerRect.top + scrollContainer.scrollTop
    let targetScrollTop: number
    if (block === 'start') {
      targetScrollTop = elTopRelative
    } else if (block === 'end') {
      targetScrollTop = elTopRelative - containerRect.height + elRect.height
    } else {
      // 'center' (default)
      targetScrollTop = elTopRelative - containerRect.height / 2 + elRect.height / 2
    }
    targetScrollTop = Math.max(0, Math.min(targetScrollTop, scrollContainer.scrollHeight - containerRect.height))
    scrollContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' })
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
        this.scrollIntoViewIfNeeded(row, 'center')
        // Brief flash highlight on the relevant side only — elevate the
        // outer wrapper's z-index so the outline isn't covered by adjacent
        // absolutely-positioned rows.
        const sideDiv = row.querySelector(`.${side}`) as HTMLElement | null
        const outerWrapper = row.parentElement as HTMLElement | null
        if (sideDiv) sideDiv.style.outline = '2px solid var(--diff-selected-border-color)'
        if (outerWrapper) outerWrapper.style.zIndex = '20'
        setTimeout(() => {
          if (sideDiv) sideDiv.style.outline = ''
          if (outerWrapper) outerWrapper.style.zIndex = ''
        }, 1000)

        // Horizontal scroll: bring highlighted content on this line into view
        const fc = row.closest('[data-file-path]')
        if (fc) {
          const sideEl = row.querySelector(`.${side}`)
          // Prefer scrolling to the component highlight; fall back to content start
          const highlight = sideEl?.querySelector(
            '.component-char-highlight, .component-char-click-capture'
          ) as HTMLElement
          if (highlight) {
            scrollHorizontallyToElement(fc, side, highlight)
          } else {
            const cw = sideEl?.querySelector('.content-wrapper') as HTMLElement
            if (cw) {
              scrollHorizontallyToElement(fc, side, cw)
            }
          }
        }
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

    if (this.state.selectedComponent === 'all' || this.state.selectedComponent === 'misc') return
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
        const entryLine = parseInt(change.from.position.split(':')[0], 10)
        const entrySide: 'before' | 'after' = change.kind === 'Removal' ? 'before' : 'after'
        this.setState({
          selectedNodeInfo: {
            javaId: change.from.java_id,
            type: change.from.type,
            content: change.from.content || '',
            position: change.from.position,
            file: change.from.file,
            componentIndex
          },
          selectedRightPanelLine: `${change.from.file}:${entryLine}:${entrySide}`
        })
        return
      }
      if (change.to && pathMatches(change.to.file, filePath) && change.to.position === pos) {
        const entryLine = parseInt(change.to.position.split(':')[0], 10)
        const entrySide: 'before' | 'after' = change.kind === 'Removal' ? 'before' : 'after'
        this.setState({
          selectedNodeInfo: {
            javaId: change.to.java_id,
            type: change.to.type,
            content: change.to.content || '',
            position: change.to.position,
            file: change.to.file,
            componentIndex
          },
          selectedRightPanelLine: `${change.to.file}:${entryLine}:${entrySide}`
        })
        return
      }
    }
  }

  /**
   * Compute the right-panel entries: all changed lines in the current component
   * from diff_nodes.json, deduplicated by file:line:side, sorted by reachable_by
   * descending.
   */
  private computeRightPanelEntries(): Array<{
    key: string
    file: string
    fullPath: string
    line: number
    startCol: number
    side: 'before' | 'after'
    reachable_by: number
    content: string
    /** Highlight ranges within `content` (0-based offsets into the display string) */
    contentHighlightRanges: Array<{ start: number; end: number }>
  }> {
    if (this.state.selectedComponent === 'all' || this.state.selectedComponent === 'misc') return []
    const componentIndex = this.state.selectedComponent as number
    const component = this.state.diffComponents[componentIndex]
    if (!component) return []

    const nodeData = this.state.diffNodes.find(
      (n: any) => n.component_id === component.component_id
    )
    if (!nodeData || !nodeData.nodes) return []

    // Collect unique file:line:side entries, keeping earliest startCol and max reachable_by
    const lineMap = new Map<string, {
      file: string
      line: number
      startCol: number
      side: 'before' | 'after'
      reachable_by: number
    }>()

    for (const node of nodeData.nodes) {
      if (!node.position || !node.file) continue
      const parts = node.position.split(':')
      if (parts.length < 2) continue
      let startLine = parseInt(parts[0], 10)
      const startCol = parseInt(parts[1].split('-')[0], 10)
      const side: 'before' | 'after' = node.kind === 'Removal' ? 'before' : 'after'

      // For multi-line MethodDeclaration nodes, skip past annotation / blank
      // lines so the right panel shows the actual method signature.
      const isMultiLine = parts.length >= 3
      if (isMultiLine && node.type && node.type.startsWith('MethodDeclaration')) {
        const endLine = parseInt(parts[1].split('-')[1], 10)
        for (let l = startLine; l <= endLine; l++) {
          const src = this.getLineContentWithFallback(node.file, l, side)
          if (src === '') {
            startLine = l
            break
          }
          const trimmed = src.trimStart()
          if (trimmed.length > 0 && !trimmed.startsWith('@') && !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
            startLine = l
            break
          }
        }
      }

      // Right panel shows one entry per node at the start line (signature line).
      const key = `${node.file}:${startLine}:${side}`

      const existing = lineMap.get(key)
      if (!existing) {
        lineMap.set(key, {
          file: node.file,
          line: startLine,
          startCol,
          side,
          reachable_by: node.reachable_by ?? 0
        })
      } else {
        if (startCol < existing.startCol) {
          existing.startCol = startCol
        }
        if ((node.reachable_by ?? 0) > existing.reachable_by) {
          existing.reachable_by = node.reachable_by
        }
      }
    }

    // Sort by reachable_by descending, then file (lexicographic), then line number
    const entries = Array.from(lineMap.entries())
      .sort((a, b) => {
        const reachDiff = b[1].reachable_by - a[1].reachable_by
        if (reachDiff !== 0) return reachDiff
        const fileCmp = (a[1].file ?? '').localeCompare(b[1].file ?? '')
        if (fileCmp !== 0) return fileCmp
        return a[1].line - b[1].line
      })

    // Build a lookup to resolve bare filenames to full relative paths
    const resolveFullPath = (bareFile: string): string => {
      for (const fc of this.state.fileChanges) {
        if (
          fc.path === bareFile ||
          fc.path.endsWith('/' + bareFile) ||
          fc.path.endsWith('\\' + bareFile)
        ) {
          return fc.path
        }
      }
      return bareFile
    }

    // Pre-compute char-level highlight ranges per file using only
    // diff_components edge endpoints (exclude diff_nodes container spans
    // which can produce spurious single-char highlights, e.g. a
    // MethodInvocation node highlighting just the first letter of a line).
    const highlightCache = new Map<string, import('./folder-compare-highlight').LineHighlight[]>()
    const getHighlightsForFile = (file: string) => {
      if (!highlightCache.has(file)) {
        highlightCache.set(file, getHighlightedLinesForComponent(
          this.state.diffComponents, componentIndex, file
        ))
      }
      return highlightCache.get(file)!
    }

    return entries.map(([key, entry]) => {
      // Get full line content — try diff hunks first, fall back to
      // fileContentsMap for lines in inter-hunk gaps.
      const rawContent = this.getLineContentWithFallback(
        entry.file, entry.line, entry.side
      )

      const trimmed = rawContent.trimStart()
      const leadingWS = rawContent.length - trimmed.length

      // Use the highlight column ranges (now merged from both diff_components
      // edge endpoints AND diff_nodes node spans) to determine where the
      // display content should start.  Fall back to the node's startCol if
      // no char-level highlight exists for this line.
      const fileHighlights = getHighlightsForFile(entry.file)
      const lineHighlight = fileHighlights.find(
        h => h.line === entry.line && h.side === entry.side
      )
      const effectiveStartCol = lineHighlight && lineHighlight.ranges.length > 0
        ? Math.min(...lineHighlight.ranges.map(r => r.startCol))
        : entry.startCol

      const remainingCol = Math.max(0, effectiveStartCol - leadingWS)
      const displayContent = trimmed.substring(remainingCol)

      // Map the char-level highlight ranges into offsets within displayContent
      // so the renderer can color them purple.
      const displayOffset = leadingWS + remainingCol // columns consumed before displayContent
      const contentHighlightRanges: Array<{ start: number; end: number }> = []
      if (lineHighlight) {
        for (const r of lineHighlight.ranges) {
          const s = r.startCol - displayOffset
          const e = r.endCol - displayOffset
          if (e > 0 && s < displayContent.length) {
            contentHighlightRanges.push({
              start: Math.max(0, s),
              end: Math.min(displayContent.length, e)
            })
          }
        }
        // Sort and merge overlapping / duplicate ranges
        contentHighlightRanges.sort((a, b) => a.start - b.start)
        let wi = 0
        for (let ri = 0; ri < contentHighlightRanges.length; ri++) {
          if (wi > 0 && contentHighlightRanges[ri].start <= contentHighlightRanges[wi - 1].end) {
            // Overlaps or is adjacent — extend the previous range
            contentHighlightRanges[wi - 1].end = Math.max(
              contentHighlightRanges[wi - 1].end,
              contentHighlightRanges[ri].end
            )
          } else {
            contentHighlightRanges[wi++] = contentHighlightRanges[ri]
          }
        }
        contentHighlightRanges.length = wi
      }

      return {
        key,
        ...entry,
        fullPath: resolveFullPath(entry.file),
        content: displayContent || '(empty)',
        contentHighlightRanges
      }
    })
  }

  /**
   * Count total unique highlighted lines across all files for the selected
   * component — used for the "Changed Lines (N)" header.
   */
  private countTotalChangedLines(): number {
    if (this.state.selectedComponent === 'all' || this.state.selectedComponent === 'misc') return 0
    let count = 0
    for (const file of this.state.fileChanges) {
      const highlights = getHighlightedLinesForComponent(
        this.state.diffComponents, this.state.selectedComponent, file.path, this.state.diffNodes
      )
      count += highlights.length
    }
    return count
  }

  /**
   * Get source line content, falling back to fileContentsMap for lines in
   * inter-hunk gaps where getSourceLineContent returns empty.
   */
  private getLineContentWithFallback(
    fileName: string,
    lineNum: number,
    side: 'before' | 'after'
  ): string {
    const fromDiff = getSourceLineContent(fileName, lineNum, side, this.state.fileDiffs)
    if (fromDiff !== '') return fromDiff

    // Fall back to fileContentsMap for lines in inter-hunk gaps
    for (const [, contents] of this.state.fileContentsMap) {
      const filePath = contents.file.path
      if (
        filePath === fileName ||
        filePath.endsWith('/' + fileName) ||
        filePath.endsWith('\\' + fileName)
      ) {
        const lines = side === 'before' ? contents.oldContents : contents.newContents
        if (lineNum >= 1 && lineNum <= lines.length) {
          return lines[lineNum - 1]
        }
      }
    }
    return ''
  }

  /**
   * Right panel: shows all changed lines in the component, sorted by
   * reachable_by score. Always visible when a component is selected.
   */
  private renderRightPanel(): JSX.Element | null {
    if (this.state.selectedComponent === 'all' || this.state.selectedComponent === 'misc') return null

    const entries = this.computeRightPanelEntries()

    // Total changed lines: count all unique highlighted lines across all files.
    const totalChangedLines = this.countTotalChangedLines()

    const componentIndex = this.state.selectedComponent as number
    const component = this.state.diffComponents[componentIndex]
    const componentName = component?.component_name || `Component ${component?.component_id ?? '?'}`
    const componentKind = component?.component_kind || 'unknown'
    const kindLabels: Record<string, string> = {
      delete: 'Deletion',
      add: 'Addition',
      rename: 'Rename',
      modify: 'Modification',
      other: 'Other',
    }
    const kindLabel = kindLabels[componentKind] || componentKind.charAt(0).toUpperCase() + componentKind.slice(1)

    return (
      <div className="right-panel" style={{
        width: `${this.state.rightPanelWidth}px`,
        minWidth: `${MIN_RIGHT_PANEL_WIDTH}px`,
        backgroundColor: 'var(--box-alt-background-color)',
        padding: '15px',
        overflow: 'auto',
        flexShrink: 0
      }}>
        <div style={{
          padding: '12px 14px',
          marginBottom: '15px',
          borderRadius: '6px',
          backgroundColor: 'var(--box-border-color)',
          opacity: 0.85
        }}>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary-color)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {kindLabel}
          </div>
          <div style={{ fontSize: 'calc(var(--font-size) + 4px)', fontWeight: 700, color: 'var(--text-color)', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
            {componentName}
          </div>
        </div>

        <h3 style={{ margin: '0 0 15px 0', fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
          Changed Lines ({totalChangedLines})
        </h3>

        {entries.length === 0 && (
          <div style={{ fontSize: 'var(--font-size)', color: 'var(--text-secondary-color)', fontStyle: 'italic' }}>
            No changed lines
          </div>
        )}

        {(() => {
          // Likely source: the entry with the unique max reachable_by, or the first
          // among exactly 2 entries that share the max. 3+ sharing the max → no badge.
          const maxReachable = entries.length > 0 ? Math.max(...entries.map(e => e.reachable_by)) : 0
          const maxCount = entries.filter(e => e.reachable_by === maxReachable).length
          const likelySourceKey = maxReachable > 0 && maxCount <= 2
            ? entries.find(e => e.reachable_by === maxReachable)!.key
            : null

          return entries.map(entry => {
            const isSelected = this.state.selectedRightPanelLine === entry.key
            const isLikelySource = entry.key === likelySourceKey
            return (
              <div key={entry.key} className="right-panel-entry" style={{
                fontSize: 'var(--font-size-sm)',
                padding: '10px',
                marginBottom: '6px',
                backgroundColor: isSelected ? 'var(--box-border-color)' : 'var(--background-color)',
                borderRadius: '4px',
                borderLeft: `3px solid ${isSelected ? 'var(--diff-selected-border-color)' : 'transparent'}`,
                cursor: 'pointer'
              }}
              onClick={() => {
                this.setState({ selectedRightPanelLine: entry.key })
                this.scrollToLine(entry.file, entry.line, entry.side)
              }}
              >
                <div style={{
                  marginBottom: '4px',
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--text-secondary-color)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    direction: 'rtl',
                    textAlign: 'left',
                    minWidth: 0,
                    flex: 1,
                  }}>
                    <span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{entry.fullPath}:{entry.line} <span style={{ color: 'var(--text-color)', fontWeight: 700, fontSize: 'var(--font-size-md)' }}>({entry.side === 'before' ? '-' : '+'})</span></span>
                  </span>
                  {isLikelySource && (
                    <span style={{
                      color: '#d4a017',
                      fontWeight: 700,
                      fontSize: 'var(--font-size-xs)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      flexShrink: 0,
                      marginLeft: '8px'
                    }}>
                      Likely source
                    </span>
                  )}
                </div>
                <div style={{
                  fontFamily: 'var(--font-family-monospace)',
                  color: 'var(--text-color)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontSize: 'var(--font-size)'
                }}>
                  {entry.contentHighlightRanges.length > 0
                    ? (() => {
                        const parts: JSX.Element[] = []
                        let cursor = 0
                        for (let ri = 0; ri < entry.contentHighlightRanges.length; ri++) {
                          const { start, end } = entry.contentHighlightRanges[ri]
                          if (cursor < start) {
                            parts.push(<span key={`t${ri}`}>{entry.content.slice(cursor, start)}</span>)
                          }
                          parts.push(
                            <span key={`h${ri}`} style={{ color: '#c586c0', fontWeight: 600 }}>
                              {entry.content.slice(start, end)}
                            </span>
                          )
                          cursor = end
                        }
                        if (cursor < entry.content.length) {
                          parts.push(<span key="tail">{entry.content.slice(cursor)}</span>)
                        }
                        return parts
                      })()
                    : entry.content
                  }
                </div>
              </div>
            )
          })
        })()}
      </div>
    )
  }

  /**
   * Extract hunk boundary info from the DOM after highlighting is applied.
   * Each entry corresponds to a component-hunk-start row.
   */
  private extractHunkEntriesFromDOM(): Array<{
    fileName: string
    beforeLine: number | null
    afterLine: number | null
  }> {
    const entries: Array<{fileName: string, beforeLine: number | null, afterLine: number | null}> = []
    document.querySelectorAll('.folder-compare-view [data-file-path]').forEach(fileContainer => {
      const filePath = (fileContainer as HTMLElement).dataset.filePath || ''
      if (fileContainer.classList.contains('component-file-hidden')) return

      const hunkStartRows = fileContainer.querySelectorAll('.component-hunk-start')
      const allRows = Array.from(
        fileContainer.querySelectorAll('.row:not(.component-hunk-separator)')
      ) as HTMLElement[]
      hunkStartRows.forEach(row => {
        let beforeLine = row.querySelector('.before .line-number')
          ? extractLineNumber(row.querySelector('.before .line-number')!)
          : null
        let afterLine = row.querySelector('.after .line-number')
          ? extractLineNumber(row.querySelector('.after .line-number')!)
          : null

        // If a side has no line number (e.g. pure add/delete), scan forward
        // through visible rows to find the next row with a line number on
        // that side.
        if (beforeLine === null || afterLine === null) {
          const rowIdx = allRows.indexOf(row as HTMLElement)
          if (rowIdx >= 0) {
            for (let i = rowIdx + 1; i < allRows.length; i++) {
              const r = allRows[i]
              if (r.closest('.component-hidden') || r.classList.contains('component-hidden')) continue
              const parent = r.parentElement
              if (parent && parent.classList.contains('component-hidden')) continue
              if (beforeLine === null) {
                const bl = r.querySelector('.before .line-number')
                if (bl) beforeLine = extractLineNumber(bl)
              }
              if (afterLine === null) {
                const al = r.querySelector('.after .line-number')
                if (al) afterLine = extractLineNumber(al)
              }
              if (beforeLine !== null && afterLine !== null) break
            }
          }
        }

        entries.push({ fileName: filePath, beforeLine, afterLine })
      })
    })
    return entries
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

  /**
   * Render the "+N / -N" addition/deletion stats badge for a file header.
   * Counts update based on the current view:
   * - "all": total additions/deletions in the file
   * - component: only lines belonging to that component
   * - "misc": only lines not claimed by any component
   * Only shows additions (green) if > 0, only shows deletions (red) if > 0.
   */
  private renderDiffStats(fileId: string, filePath: string): JSX.Element | null {
    const diff = this.state.fileDiffs.get(fileId)
    if (!diff) return null

    let additions = 0
    let deletions = 0

    if (this.state.selectedComponent === 'all') {
      // Show all: count every addition/deletion
      for (const hunk of diff.hunks) {
        for (const line of hunk.lines) {
          if (line.type === DiffLineType.Add) additions++
          else if (line.type === DiffLineType.Delete) deletions++
        }
      }
    } else if (this.state.selectedComponent === 'misc') {
      // Misc: count only lines NOT claimed by any component
      const claimedLines = getClaimedLineNumbers(this.state.diffComponents, filePath)
      for (const hunk of diff.hunks) {
        for (const line of hunk.lines) {
          if (line.type === DiffLineType.Add) {
            if (line.newLineNumber !== null && !claimedLines.has(line.newLineNumber)) additions++
          } else if (line.type === DiffLineType.Delete) {
            if (line.oldLineNumber !== null && !claimedLines.has(line.oldLineNumber)) deletions++
          }
        }
      }
    } else {
      // Component view: count only lines highlighted by this component.
      // Lines may be in diff hunks (add/delete) or in inter-hunk gaps
      // (part of a multi-line node span that extends beyond the hunk).
      const highlights = getHighlightedLinesForComponent(
        this.state.diffComponents, this.state.selectedComponent, filePath, this.state.diffNodes
      )
      const beforeLines = new Set<number>()
      const afterLines = new Set<number>()
      for (const h of highlights) {
        if (h.side === 'before') beforeLines.add(h.line)
        else afterLines.add(h.line)
      }
      const countedAfter = new Set<number>()
      const countedBefore = new Set<number>()
      for (const hunk of diff.hunks) {
        for (const line of hunk.lines) {
          if (line.type === DiffLineType.Add) {
            if (line.newLineNumber !== null && afterLines.has(line.newLineNumber)) {
              additions++
              countedAfter.add(line.newLineNumber)
            }
          } else if (line.type === DiffLineType.Delete) {
            if (line.oldLineNumber !== null && beforeLines.has(line.oldLineNumber)) {
              deletions++
              countedBefore.add(line.oldLineNumber)
            }
          }
        }
      }
      // Count component lines in inter-hunk gaps (not in any hunk)
      for (const l of afterLines) {
        if (!countedAfter.has(l)) additions++
      }
      for (const l of beforeLines) {
        if (!countedBefore.has(l)) deletions++
      }
    }

    if (additions === 0 && deletions === 0) return null

    return (
      <div style={{
        display: 'flex',
        gap: '8px',
        fontSize: 'var(--font-size-md)',
        fontWeight: 700,
        fontFamily: 'monospace',
        flexShrink: 0,
        marginLeft: '12px',
      }}>
        {additions > 0 && (
          <span style={{ color: '#28a745' }}>+{additions}</span>
        )}
        {deletions > 0 && (
          <span style={{ color: '#d73a49' }}>-{deletions}</span>
        )}
      </div>
    )
  }

  private onFolderSelectorDismissed = () => {
    // User closed the dialog without selecting folders
    // For now, just keep it open
  }

  private onCompareFolders = async (
    beforeFolder: string,
    afterFolder: string,
    diffmagicFolder: string
  ) => {
    this.setState({
      showFolderSelector: false,
      beforeFolder,
      afterFolder,
      diffmagicFolder,
      isLoading: true,
      isLoadingDiffs: false,
      fileChanges: [],
      fileDiffs: new Map(),
      diffComponents: [],
      diffNodes: [],
      selectedComponent: 'all',
      selectedNodeInfo: null,
      collapsedKinds: [],
      collapsedFolders: [],
      hunkEntries: [],
      selectedRightPanelLine: null,
      fileContentsMap: new Map(),
    })

    try {
      const [fileChanges, { diffComponents, diffNodes }] = await Promise.all([
        compareDirectories(beforeFolder, afterFolder),
        loadDiffComponents(diffmagicFolder || undefined),
      ])

      this.setState({
        diffComponents,
        diffNodes,
        fileChanges,
        isLoading: false,
        isLoadingDiffs: true,
      })

      // Run file-contents loading (for syntax highlighting) concurrently
      // with diff loading.
      const fileContentsPromise = this.buildFileContentsMap(
        beforeFolder,
        afterFolder,
        fileChanges
      ).then(fileContentsMap => {
        this.setState({ fileContentsMap })
      })

      // Try to load precomputed diffs from the diffmagic folder first.
      // If found, skip the expensive per-file diff computation entirely.
      let diffsPromise: Promise<unknown>

      const precomputed = diffmagicFolder
        ? await loadPrecomputedDiffs(diffmagicFolder)
        : null

      if (precomputed !== null) {
        console.log('Using precomputed diffs — skipping in-process diff computation')
        this.setState({ fileDiffs: precomputed })
        diffsPromise = Promise.resolve()
      } else {
        diffsPromise = loadAllDiffs(
          beforeFolder,
          afterFolder,
          fileChanges,
          diffs => this.setState({ fileDiffs: diffs })
        )
      }

      await Promise.all([fileContentsPromise, diffsPromise])

      this.setState({ isLoadingDiffs: false })
    } catch (error) {
      console.error('Error comparing folders:', error)
      this.setState({ isLoading: false, isLoadingDiffs: false })
    }
  }

  /** Maximum bytes to read per file for syntax highlighting (256 KB). */
  private static readonly MaxHighlightContentLength = 256 * 1024

  /**
   * Read old/new file contents from disk and build IFileContents entries
   * so the Diff component can run its normal syntax-highlighting pipeline.
   */
  private async buildFileContentsMap(
    beforeFolder: string,
    afterFolder: string,
    fileChanges: ReadonlyArray<WorkingDirectoryFileChange>
  ): Promise<Map<string, IFileContents>> {
    const max = FolderCompareView.MaxHighlightContentLength

    const readFile = async (filePath: string): Promise<ReadonlyArray<string>> => {
      try {
        const buf = await FSPromises.readFile(filePath)
        const text = buf.slice(0, max).toString('utf8')
        return text.split(/\r?\n/)
      } catch {
        return []
      }
    }

    const map = new Map<string, IFileContents>()

    await Promise.all(
      fileChanges.map(async file => {
        const oldPath = Path.join(beforeFolder, file.path)
        const newPath = Path.join(afterFolder, file.path)

        const isNew = file.status.kind === AppFileStatusKind.New ||
                      file.status.kind === AppFileStatusKind.Untracked
        const isDeleted = file.status.kind === AppFileStatusKind.Deleted

        const [oldContents, newContents] = await Promise.all([
          isNew ? Promise.resolve([]) : readFile(oldPath),
          isDeleted ? Promise.resolve([]) : readFile(newPath),
        ])

        map.set(file.id, {
          file,
          oldContents,
          newContents,
          canBeExpanded: false,
        })
      })
    )

    return map
  }

  private onComponentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    this.setState({
      selectedComponent: value === 'all' ? 'all' : value === 'misc' ? 'misc' : parseInt(value, 10),
      selectedNodeInfo: null,
      hunkEntries: [],
      selectedRightPanelLine: null,
    })
  }

  /**
   * Handle the custom `select-rename-component` event dispatched by rename
   * info icon tooltips.  Selects the component in the left panel and ensures
   * the "Renames" kind group is expanded so the selected radio is visible.
   */
  private onSelectRenameComponent = (e: CustomEvent) => {
    const componentIndex = e.detail?.componentIndex as number | undefined
    if (componentIndex === undefined) return

    // Ensure "rename" kind group is expanded
    this.setState(prevState => {
      const collapsed = [...prevState.collapsedKinds]
      const idx = collapsed.indexOf('rename')
      if (idx >= 0) {
        collapsed.splice(idx, 1)
      }
      return {
        selectedComponent: componentIndex,
        selectedNodeInfo: null,
        hunkEntries: [],
        selectedRightPanelLine: null,
        collapsedKinds: collapsed,
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Window resize — refresh scroll-sync bar widths (handles zoom changes)
  // ---------------------------------------------------------------------------
  private resizeRAF: number | null = null
  private onWindowResize = () => {
    if (this.resizeRAF) cancelAnimationFrame(this.resizeRAF)
    this.resizeRAF = requestAnimationFrame(() => {
      this.resizeRAF = null
      refreshScrollSync()
    })
  }

  // ---------------------------------------------------------------------------
  // Resize drag handlers
  // ---------------------------------------------------------------------------

  private draggingHandle: 'left-h' | 'right-h' | 'left-v' | null = null
  private dragStartX = 0
  private dragStartY = 0
  private dragStartValue = 0
  private dragStartSidebarHeight = 0

  private onLeftHorizontalResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    this.draggingHandle = 'left-h'
    this.dragStartX = e.clientX
    this.dragStartValue = this.state.leftPanelWidth
    document.addEventListener('mousemove', this.onResizeMove)
    document.addEventListener('mouseup', this.onResizeEnd)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    this.forceUpdate()
  }

  private onRightHorizontalResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    this.draggingHandle = 'right-h'
    this.dragStartX = e.clientX
    this.dragStartValue = this.state.rightPanelWidth
    document.addEventListener('mousemove', this.onResizeMove)
    document.addEventListener('mouseup', this.onResizeEnd)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    this.forceUpdate()
  }

  private onLeftVerticalResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    this.draggingHandle = 'left-v'
    this.dragStartY = e.clientY
    this.dragStartValue = this.state.leftTopFraction
    // measure the sidebar height for fraction calculation
    const sidebar = (e.currentTarget as HTMLElement).closest('.component-selector-sidebar') as HTMLElement
    this.dragStartSidebarHeight = sidebar ? sidebar.clientHeight : 600
    document.addEventListener('mousemove', this.onResizeMove)
    document.addEventListener('mouseup', this.onResizeEnd)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    this.forceUpdate()
  }

  private onResizeMove = (e: MouseEvent) => {
    if (this.draggingHandle === 'left-h') {
      const delta = e.clientX - this.dragStartX
      const containerWidth = document.querySelector('.folder-compare-view')?.clientWidth ?? window.innerWidth
      const hasRight = this.state.selectedComponent !== 'all' && this.state.selectedComponent !== 'misc'
      const rightReserved = hasRight ? this.state.rightPanelWidth + 4 : 0
      const maxLeft = containerWidth - rightReserved - MIN_MIDDLE_PANEL_WIDTH - 4
      const newWidth = Math.max(MIN_LEFT_PANEL_WIDTH, Math.min(maxLeft, this.dragStartValue + delta))
      this.setState({ leftPanelWidth: newWidth })
    } else if (this.draggingHandle === 'right-h') {
      const delta = e.clientX - this.dragStartX
      const containerWidth = document.querySelector('.folder-compare-view')?.clientWidth ?? window.innerWidth
      const hasLeft = this.state.diffComponents.length > 0
      const leftReserved = hasLeft ? this.state.leftPanelWidth + 4 : 0
      const maxRight = containerWidth - leftReserved - MIN_MIDDLE_PANEL_WIDTH - 4
      // Right panel grows when mouse moves LEFT (negative delta)
      const newWidth = Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(maxRight, this.dragStartValue - delta))
      this.setState({ rightPanelWidth: newWidth })
    } else if (this.draggingHandle === 'left-v') {
      const delta = e.clientY - this.dragStartY
      const sidebarH = this.dragStartSidebarHeight
      if (sidebarH <= 0) return
      const minTopFrac = MIN_LEFT_TOP_HEIGHT / sidebarH
      const maxTopFrac = 1 - MIN_LEFT_BOTTOM_HEIGHT / sidebarH
      const newFrac = Math.max(minTopFrac, Math.min(maxTopFrac, this.dragStartValue + delta / sidebarH))
      this.setState({ leftTopFraction: newFrac })
    }
  }

  private onResizeEnd = () => {
    this.draggingHandle = null
    document.removeEventListener('mousemove', this.onResizeMove)
    document.removeEventListener('mouseup', this.onResizeEnd)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    this.forceUpdate()
  }

  // ---------------------------------------------------------------------------
  // File tree helpers
  // ---------------------------------------------------------------------------

  private buildFileTree(filePaths: string[]): FileTreeNode {
    const root: FileTreeNode = { name: '', fullPath: '', children: [], filePaths: [] }
    for (const fp of filePaths) {
      const parts = fp.split('/')
      let node = root
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const isFile = i === parts.length - 1
        if (isFile) {
          node.filePaths.push(fp)
        } else {
          let child = node.children.find(c => c.name === part)
          if (!child) {
            child = {
              name: part,
              fullPath: parts.slice(0, i + 1).join('/'),
              children: [],
              filePaths: [],
            }
            node.children.push(child)
          }
          node = child
        }
      }
    }
    // Merge single-child folder chains
    const merge = (node: FileTreeNode): void => {
      for (const child of node.children) merge(child)
      while (
        node.children.length === 1 &&
        node.filePaths.length === 0 &&
        node.name !== '' // don't merge into root
      ) {
        const only = node.children[0]
        node.name = node.name + '/' + only.name
        node.fullPath = only.fullPath
        node.children = only.children
        node.filePaths = only.filePaths
      }
    }
    for (const child of root.children) merge(child)
    return root
  }

  private toggleFolderCollapse = (folderPath: string) => {
    this.setState(prevState => {
      const collapsed = [...prevState.collapsedFolders]
      const idx = collapsed.indexOf(folderPath)
      if (idx >= 0) {
        collapsed.splice(idx, 1)
      } else {
        collapsed.push(folderPath)
      }
      return { collapsedFolders: collapsed }
    })
  }

  private renderFileTree(filePaths: string[]): JSX.Element {
    const tree = this.buildFileTree(filePaths)
    return <div>{this.renderTreeNodes(tree, 0)}</div>
  }

  private renderTreeNodes(node: FileTreeNode, depth: number): JSX.Element[] {
    const elements: JSX.Element[] = []
    const indent = depth * 16

    // Sort: folders first, then files
    const sortedChildren = [...node.children].sort((a, b) => a.name.localeCompare(b.name))
    const sortedFiles = [...node.filePaths].sort()

    for (const child of sortedChildren) {
      const isCollapsed = this.state.collapsedFolders.includes(child.fullPath)
      elements.push(
        <div
          key={'folder:' + child.fullPath}
          className="sidebar-file-entry"
          style={{
            padding: '3px 6px',
            paddingLeft: `${6 + indent}px`,
            fontSize: 'var(--font-size)',
            borderRadius: '3px',
            color: 'var(--text-color)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          title={child.fullPath}
          onClick={() => this.toggleFolderCollapse(child.fullPath)}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--box-border-color)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <span style={{
            fontSize: 'var(--font-size-xs)',
            display: 'inline-block',
            transition: 'transform 0.15s',
            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            flexShrink: 0,
            width: '10px',
            textAlign: 'center',
          }}>&#9660;</span>
          <svg width="14" height="14" viewBox="0 0 16 16" style={{ flexShrink: 0, fill: '#888' }}>
            <path d="M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1H13a1 1 0 0 1 1 1v.5H2.75a.75.75 0 0 0 0 1.5h11.978a1 1 0 0 1 .994 1.117L15 13.25A1.75 1.75 0 0 1 13.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75c0-.464.184-.91.513-1.237Z"/>
          </svg>
          <span style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            direction: 'rtl',
            textAlign: 'left',
            flex: 1,
            minWidth: 0,
          }}>
            <span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{child.name}</span>
          </span>
        </div>
      )
      if (!isCollapsed) {
        elements.push(...this.renderTreeNodes(child, depth + 1))
      }
    }

    for (const fp of sortedFiles) {
      const fileName = fp.split('/').pop() || fp
      elements.push(
        <div
          key={'file:' + fp}
          className="sidebar-file-entry"
          style={{
            padding: '3px 6px',
            paddingLeft: `${6 + indent + 14}px`,
            fontSize: 'var(--font-size)',
            borderRadius: '3px',
            color: 'var(--text-color)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            cursor: 'pointer',
          }}
          title={fp}
          onClick={() => this.scrollToFile(fp)}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--box-border-color)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" style={{ flexShrink: 0, fill: '#888' }}>
            <path d="M1 1.75C1 .784 1.784 0 2.75 0h7.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073ZM8 3.25a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0V7h-1.5a.75.75 0 0 1 0-1.5h1.5V4A.75.75 0 0 1 8 3.25Zm-3 8a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z"/>
          </svg>
          <span style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}>{fileName}</span>
        </div>
      )
    }

    return elements
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

  // ---------------------------------------------------------------------------
  // Folder-level search (Ctrl+F)
  // ---------------------------------------------------------------------------

  /**
   * Capture-phase handler for the custom 'find-text' event dispatched by
   * app.tsx when the user presses Ctrl+F.  By stopping propagation in the
   * capture phase we prevent every individual SideBySideDiff instance from
   * opening its own search bar.
   */
  private onFolderFindText = (e: Event) => {
    if (this.state.showFolderSelector) return
    e.stopPropagation()
    e.preventDefault()
    if (!this.state.isSearching) {
      this.setState({ isSearching: true })
    }
  }

  /**
   * Capture-phase keydown handler — catches Ctrl+F before SideBySideDiff's
   * own window-level keydown listener can open per-file search.
   */
  private onFolderKeyDown = (e: KeyboardEvent) => {
    if (this.state.showFolderSelector) return
    if (e.key === 'Escape' && this.state.isSearching) {
      e.stopPropagation()
      e.preventDefault()
      this.closeFolderSearch()
      return
    }
    const isCmdOrCtrl = e.ctrlKey || e.metaKey
    if (isCmdOrCtrl && !e.shiftKey && !e.altKey && e.key === 'f') {
      e.stopPropagation()
      e.preventDefault()
      if (!this.state.isSearching) {
        this.setState({ isSearching: true })
      }
    }
  }

  private closeFolderSearch = () => {
    // Suspend observer for the entire close-search operation so that
    // clearSearchHighlight + setState DOM updates don't trigger repack.
    this.suspendObserver()
    try {
      this.clearSearchHighlight()
      this.folderSearchMatches = []
      this.folderSearchIndex = -1
      this.folderSearchQuery = ''
      this.setState({ isSearching: false })
    } finally {
      this.resumeObserver()
    }
  }

  private onFolderSearch = (query: string, direction: 'next' | 'previous') => {
    // Suspend observer for the ENTIRE search operation.  Individual helpers
    // (clearSearchHighlight, highlightAllSearchMatches) also call
    // suspend/resume, but the nested counter keeps the observer disconnected
    // until THIS outermost resume runs — after updateSearchCountDisplay.
    this.suspendObserver()
    try {
      if (!query || query.trim() === '') {
        this.clearSearchHighlight()
        this.folderSearchMatches = []
        this.folderSearchIndex = -1
        this.folderSearchQuery = ''
        this.updateSearchCountDisplay()
        return
      }

      if (query !== this.folderSearchQuery) {
        // New search
        this.folderSearchQuery = query
        this.folderSearchMatches = this.findMatchingSides(query)
        this.folderSearchIndex = this.folderSearchMatches.length > 0 ? 0 : -1
      } else if (this.folderSearchMatches.length > 0) {
        // Navigate within existing results
        const delta = direction === 'next' ? 1 : -1
        this.folderSearchIndex =
          (this.folderSearchIndex + delta + this.folderSearchMatches.length) %
          this.folderSearchMatches.length
      }

      this.clearSearchHighlight()
      this.highlightAllSearchMatches()
      this.updateSearchCountDisplay()
    } finally {
      this.resumeObserver()
    }
  }

  /**
   * Walk the visible diff rows in the middle panel and return a list of
   * per-occurrence matches.  Each entry is a {row, side, occurrence} tuple.
   * Both sides of every row are searched independently.  If the query appears
   * N times on one side, N separate entries are created (occurrence 0..N-1).
   * Order: top-to-bottom, and within each row before (LHS) first then
   * after (RHS), and within each side left-to-right.
   */
  private findMatchingSides(
    query: string
  ): Array<{ row: HTMLElement; side: 'before' | 'after'; occurrence: number }> {
    const container = document.querySelector('.folder-compare-content')
    if (!container) return []

    const matches: Array<{ row: HTMLElement; side: 'before' | 'after'; occurrence: number }> = []
    const lowerQuery = query.toLowerCase()

    const rows = container.querySelectorAll('.row')
    for (const row of Array.from(rows)) {
      const htmlRow = row as HTMLElement

      // Skip hidden / separator / hunk-info rows
      if (htmlRow.classList.contains('component-hidden')) continue
      if (htmlRow.classList.contains('component-hunk-separator')) continue
      if (htmlRow.classList.contains('hunk-info')) continue
      const parentEl = htmlRow.parentElement
      if (parentEl?.classList.contains('component-hidden')) continue
      const fc = htmlRow.closest('[data-file-path]')
      if (fc?.classList.contains('component-file-hidden')) continue

      // Count occurrences on each side
      for (const side of ['before', 'after'] as const) {
        const cw = htmlRow.querySelector(
          `.${side} .content-wrapper`
        ) as HTMLElement
        if (!cw) continue
        const text = this.getSearchableText(cw).toLowerCase()
        let searchFrom = 0
        let occ = 0
        while (true) {
          const idx = text.indexOf(lowerQuery, searchFrom)
          if (idx === -1) break
          matches.push({ row: htmlRow, side, occurrence: occ })
          occ++
          searchFrom = idx + lowerQuery.length
        }
      }
    }

    return matches
  }

  /**
   * Extract visible text from a content-wrapper, skipping overlay elements
   * (character highlight overlays, click-capture spans) that would otherwise
   * cause phantom duplicate matches.
   */
  private getSearchableText(contentWrapper: HTMLElement): string {
    let text = ''
    const walker = document.createTreeWalker(
      contentWrapper,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement
          if (!parent) return NodeFilter.FILTER_REJECT
          if (
            parent.classList.contains('component-char-highlight') ||
            parent.classList.contains('component-char-click-capture') ||
            parent.classList.contains('component-hunk-separator')
          ) {
            return NodeFilter.FILTER_REJECT
          }
          return NodeFilter.FILTER_ACCEPT
        },
      }
    )
    let textNode: Text | null
    while ((textNode = walker.nextNode() as Text | null)) {
      text += textNode.textContent
    }
    return text
  }

  private clearSearchHighlight(): void {
    // Suspend observer during search-mark removal to prevent
    // normalize() from triggering applyAndRepackAll (which removes
    // expanded rows).  Detached text nodes have parentElement===null
    // so the isOurNode check cannot identify them.
    this.suspendObserver()
    try {
      document
        .querySelectorAll('.folder-compare-view .folder-search-mark')
        .forEach(mark => {
          const parent = mark.parentNode
          if (parent) {
            parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
            parent.normalize() // merge adjacent text nodes
          }
        })
    } finally {
      this.resumeObserver()
    }
  }

  /**
   * Highlight ALL occurrences of the search query across all visible diff rows.
   * Every match gets an orange background; the currently-selected match
   * (folderSearchIndex) gets a light-blue background instead.
   */
  private highlightAllSearchMatches(): void {
    if (this.folderSearchMatches.length === 0) return

    // Suspend observer during mark insertion to prevent triggering
    // applyAndRepackAll which would remove expanded rows.
    this.suspendObserver()

    const query = this.folderSearchQuery.toLowerCase()
    const queryLen = this.folderSearchQuery.length

    // Group matches by (row + side) so we can walk each content-wrapper once.
    const groups = new Map<string, { row: HTMLElement; side: 'before' | 'after'; occurrences: number[]; globalIndices: number[] }>()
    this.folderSearchMatches.forEach((m, globalIdx) => {
      const key = `${(m.row as any).__searchGroupId ?? (((m.row as any).__searchGroupId = Math.random()), (m.row as any).__searchGroupId)}-${m.side}`
      let g = groups.get(key)
      if (!g) {
        g = { row: m.row, side: m.side, occurrences: [], globalIndices: [] }
        groups.set(key, g)
      }
      g.occurrences.push(m.occurrence)
      g.globalIndices.push(globalIdx)
    })

    // Scroll the current match into view
    if (this.folderSearchIndex >= 0) {
      const currentMatch = this.folderSearchMatches[this.folderSearchIndex]
      if (currentMatch) {
        this.scrollIntoViewIfNeeded(currentMatch.row, 'center')
      }
    }

    // Shared text-node filter (same criteria as getSearchableText).
    const acceptSearchNode = (node: Node): number => {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (
        parent.classList.contains('component-char-highlight') ||
        parent.classList.contains('component-char-click-capture') ||
        parent.classList.contains('component-hunk-separator')
      ) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    }

    for (const group of groups.values()) {
      const cw = group.row.querySelector(`.${group.side} .content-wrapper`) as HTMLElement
      if (!cw) continue

      const occurrenceSet = new Set(group.occurrences)
      const occToGlobal = new Map<number, number>()
      group.occurrences.forEach((occ, i) => occToGlobal.set(occ, group.globalIndices[i]))

      // Build a list of accepted text nodes and a concatenated text string
      // (identical to what getSearchableText produces).  This ensures
      // occurrence counting matches findMatchingSides even when a query
      // spans across text-node boundaries (created by syntax highlighting
      // or component-char-white spans).
      const textNodes: Array<{ node: Text; start: number }> = []
      let concatenated = ''
      const walker = document.createTreeWalker(
        cw,
        NodeFilter.SHOW_TEXT,
        { acceptNode: acceptSearchNode }
      )
      let tn: Text | null
      while ((tn = walker.nextNode() as Text | null)) {
        textNodes.push({ node: tn, start: concatenated.length })
        concatenated += tn.textContent || ''
      }

      const lowerConcat = concatenated.toLowerCase()

      // Find all occurrences in the concatenated text and collect the ones
      // that belong to this group's occurrence set.
      type MatchSegment = {
        textNode: Text
        /** Offset within the text node */
        idx: number
        /** Number of characters to highlight within this text node */
        len: number
        globalIndex: number
      }
      const toWrap: MatchSegment[] = []

      let searchFrom = 0
      let seen = 0
      while (true) {
        const pos = lowerConcat.indexOf(query, searchFrom)
        if (pos === -1) break
        if (occurrenceSet.has(seen)) {
          const globalIndex = occToGlobal.get(seen)!
          const matchEnd = pos + queryLen
          // Map [pos, matchEnd) back to individual text nodes.
          for (const entry of textNodes) {
            const nodeEnd = entry.start + (entry.node.textContent || '').length
            if (nodeEnd <= pos) continue   // entirely before the match
            if (entry.start >= matchEnd) break  // past the match
            const segStart = Math.max(0, pos - entry.start)
            const segEnd = Math.min((entry.node.textContent || '').length, matchEnd - entry.start)
            toWrap.push({ textNode: entry.node, idx: segStart, len: segEnd - segStart, globalIndex })
          }
        }
        seen++
        searchFrom = pos + queryLen
      }

      // Pre-compute how many segments each match has and the forward-order
      // position of each segment so we can style multi-segment matches
      // as a single continuous highlight.
      const segCountByMatch = new Map<number, number>()
      const segPosByIndex = new Map<number, number>()
      for (let i = 0; i < toWrap.length; i++) {
        const gi = toWrap[i].globalIndex
        const pos = segCountByMatch.get(gi) || 0
        segPosByIndex.set(i, pos)
        segCountByMatch.set(gi, pos + 1)
      }

      // Process in reverse to keep offsets stable
      for (let i = toWrap.length - 1; i >= 0; i--) {
        const { textNode: wtn, idx, len, globalIndex } = toWrap[i]
        const matchStart = wtn.splitText(idx)
        const afterMatch = matchStart.splitText(len)
        void afterMatch

        const mark = document.createElement('mark')
        mark.className = 'folder-search-mark'
        const isCurrent = globalIndex === this.folderSearchIndex
        if (isCurrent) mark.classList.add('folder-search-current')
        mark.textContent = matchStart.textContent

        // For matches that span multiple text nodes (e.g. across syntax
        // spans), remove inner border-radius and box-shadow so the
        // segments visually merge into a single highlight.
        const total = segCountByMatch.get(globalIndex)!
        if (total > 1) {
          const segPos = segPosByIndex.get(i)!
          if (segPos === 0) {
            // First segment: rounded left, flat right
            mark.style.borderRadius = '2px 0 0 2px'
            mark.style.boxShadow = '-1px 0 0 0 rgba(0,0,0,0.3), 0 -1px 0 0 rgba(0,0,0,0.3), 0 1px 0 0 rgba(0,0,0,0.3)'
          } else if (segPos === total - 1) {
            // Last segment: flat left, rounded right
            mark.style.borderRadius = '0 2px 2px 0'
            mark.style.boxShadow = '1px 0 0 0 rgba(0,0,0,0.3), 0 -1px 0 0 rgba(0,0,0,0.3), 0 1px 0 0 rgba(0,0,0,0.3)'
          } else {
            // Middle segment: flat both sides
            mark.style.borderRadius = '0'
            mark.style.boxShadow = '0 -1px 0 0 rgba(0,0,0,0.3), 0 1px 0 0 rgba(0,0,0,0.3)'
          }
        }

        matchStart.parentNode!.replaceChild(mark, matchStart)
      }
    }

    // Horizontal scroll: bring the current search match into view
    if (this.folderSearchIndex >= 0) {
      const currentMark = document.querySelector(
        '.folder-search-current'
      ) as HTMLElement
      if (currentMark) {
        const fc = currentMark.closest('[data-file-path]')
        const currentMatch = this.folderSearchMatches[this.folderSearchIndex]
        if (fc && currentMatch) {
          scrollHorizontallyToElement(fc, currentMatch.side, currentMark)
        }
      }
    }

    // Resume observer after all marks are inserted
    this.resumeObserver()
  }

  /**
   * Update the search-count display via the DOM ref, avoiding a full
   * React re-render (which would cascade into <Diff>/ReactVirtualized
   * re-measuring rows and corrupting clip-wrapper heights).
   */
  private updateSearchCountDisplay(): void {
    const el = this.searchCountRef.current
    if (!el) return
    if (!this.folderSearchQuery) {
      el.textContent = ''
      return
    }
    el.textContent =
      this.folderSearchMatches.length > 0
        ? `${this.folderSearchIndex + 1} of ${this.folderSearchMatches.length}`
        : 'No results'
  }

  private onChangeFolders = () => {
    this.diffHeightsAdjusted = false
    this.setState({
      showFolderSelector: true,
      fileChanges: [],
      fileDiffs: new Map(),
    })
  }

  // ---------------------------------------------------------------------------
  // Expand hunk context
  // ---------------------------------------------------------------------------

  /**
   * Handle the custom `expand-hunk-context` event dispatched by expand buttons
   * on both "Show All" hunk-info rows and component-hunk-separator rows.
   *
   * In **every** mode this reads the actual source files from the compared
   * folders and inserts context rows for the lines that the diff output did
   * not include.
   *
   * For "Show All" hunk-info rows the gap is determined from the diff hunk
   * headers.  For component-hunk-separators the gap is determined from the
   * line numbers of the adjacent visible DOM rows.
   */
  private onExpandHunkContext = async (e: CustomEvent) => {
    const outerWrapper = e.detail?.outerWrapper as HTMLElement
    if (!outerWrapper) return

    // Cancel any active shrink polling so it cannot overwrite the
    // clip-wrapper height that repackFile is about to set.
    if (this.shrinkPollingRAF !== null) {
      cancelAnimationFrame(this.shrinkPollingRAF)
      this.shrinkPollingRAF = null
    }

    const isComponentSeparator = !!e.detail?.isComponentSeparator
    const isBottomBoundary = !!e.detail?.isBottomBoundary

    // --- Locate the file container and inner scroll container ---------------
    const fileContainer = outerWrapper.closest('[data-file-path]') as HTMLElement
    if (!fileContainer) return

    const filePath = fileContainer.dataset.filePath
    if (!filePath) return

    const inner = outerWrapper.closest(
      '.ReactVirtualized__Grid__innerScrollContainer'
    ) as HTMLElement
    if (!inner) return

    // --- Read the source files first (both modes need them) ----------------
    const beforeFilePath = Path.join(this.state.beforeFolder, filePath)
    const afterFilePath = Path.join(this.state.afterFolder, filePath)

    let beforeLines: string[] = []
    let afterLines: string[] = []

    try {
      const content = await FSPromises.readFile(beforeFilePath, 'utf-8')
      beforeLines = content.split('\n')
    } catch { /* file may not exist for added files */ }

    try {
      const content = await FSPromises.readFile(afterFilePath, 'utf-8')
      afterLines = content.split('\n')
    } catch { /* file may not exist for deleted files */ }

    // --- Determine the missing line range ----------------------------------
    let beforeMissStart: number
    let beforeMissEnd: number
    let afterMissStart: number
    let afterMissEnd: number

    if (isBottomBoundary) {
      // Bottom boundary: expand from last visible line to end of file.
      // Walk backwards through inner children to find the last visible line numbers.
      const children = Array.from(inner.children) as HTMLElement[]
      let lastBeforeLine = 0
      let lastAfterLine = 0
      for (let i = children.length - 1; i >= 0; i--) {
        const el = children[i]
        if (el.classList.contains('expand-boundary-bottom')) continue
        if (el.classList.contains('expanded-context-row')) continue
        if (el.classList.contains('component-hunk-separator')) continue
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
      // Fallback: when one side has no line number (e.g. misc mode with
      // only-addition or only-deletion hunks and no context rows shown),
      // also scan hidden rows to find the correct line reference from
      // context rows that have both before and after line numbers.
      if ((lastBeforeLine === 0) !== (lastAfterLine === 0)) {
        for (let i = children.length - 1; i >= 0; i--) {
          const el = children[i]
          if (el.classList.contains('expand-boundary-bottom')) continue
          if (el.classList.contains('expanded-context-row')) continue
          if (el.classList.contains('component-hunk-separator')) continue
          const row = (el.querySelector('.row') as HTMLElement) ?? el
          if (row.classList.contains('hunk-info')) continue
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
      }
      beforeMissStart = lastBeforeLine + 1
      beforeMissEnd = beforeLines.length
      afterMissStart = lastAfterLine + 1
      afterMissEnd = afterLines.length
    } else if (isComponentSeparator) {
      // Component / misc mode: derive the gap from adjacent visible rows.
      const children = Array.from(inner.children) as HTMLElement[]
      const separatorIdx = children.indexOf(outerWrapper)
      if (separatorIdx === -1) return

      // Walk backwards to find the last visible before/after line numbers
      let lastBeforeLine = 0
      let lastAfterLine = 0
      for (let i = separatorIdx - 1; i >= 0; i--) {
        const el = children[i]
        if (el.classList.contains('component-hunk-separator')) break
        if (el.classList.contains('expanded-context-row')) continue
        if (el.classList.contains('component-hidden')) continue
        if (parseInt(el.style.top || '0', 10) < -9999) continue
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

      // Fallback: when one side has no line number (e.g. misc mode with
      // only-addition or only-deletion hunks and no context rows shown),
      // also scan hidden rows to find the correct line reference from
      // context rows that have both before and after line numbers.
      if ((lastBeforeLine === 0) !== (lastAfterLine === 0)) {
        for (let i = separatorIdx - 1; i >= 0; i--) {
          const el = children[i]
          if (el.classList.contains('component-hunk-separator')) break
          if (el.classList.contains('expanded-context-row')) continue
          if (el.classList.contains('expand-boundary-bottom')) continue
          const row = (el.querySelector('.row') as HTMLElement) ?? el
          if (row.classList.contains('hunk-info')) continue
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
      }

      // Walk forwards to find the first visible before/after line numbers
      let firstBeforeLine = Infinity
      let firstAfterLine = Infinity
      for (let i = separatorIdx + 1; i < children.length; i++) {
        const el = children[i]
        if (el.classList.contains('component-hunk-separator')) break
        if (el.classList.contains('expanded-context-row')) continue
        if (el.classList.contains('component-hidden')) continue
        if (parseInt(el.style.top || '0', 10) < -9999) continue
        const row = (el.querySelector('.row') as HTMLElement) ?? el
        if (firstBeforeLine === Infinity) {
          const n = row.querySelector('.before .line-number')
          const v = n ? extractLineNumber(n) : null
          if (v !== null) firstBeforeLine = v
        }
        if (firstAfterLine === Infinity) {
          const n = row.querySelector('.after .line-number')
          const v = n ? extractLineNumber(n) : null
          if (v !== null) firstAfterLine = v
        }
        if (firstBeforeLine !== Infinity && firstAfterLine !== Infinity) break
      }

      // Fallback: scan hidden rows when one side is missing (see backward
      // fallback above for rationale).
      if ((firstBeforeLine === Infinity) !== (firstAfterLine === Infinity)) {
        for (let i = separatorIdx + 1; i < children.length; i++) {
          const el = children[i]
          if (el.classList.contains('component-hunk-separator')) break
          if (el.classList.contains('expanded-context-row')) continue
          if (el.classList.contains('expand-boundary-bottom')) continue
          const row = (el.querySelector('.row') as HTMLElement) ?? el
          if (row.classList.contains('hunk-info')) continue
          if (firstBeforeLine === Infinity) {
            const n = row.querySelector('.before .line-number')
            const v = n ? extractLineNumber(n) : null
            if (v !== null) firstBeforeLine = v
          }
          if (firstAfterLine === Infinity) {
            const n = row.querySelector('.after .line-number')
            const v = n ? extractLineNumber(n) : null
            if (v !== null) firstAfterLine = v
          }
          if (firstBeforeLine !== Infinity && firstAfterLine !== Infinity) break
        }
      }

      beforeMissStart = lastBeforeLine + 1
      beforeMissEnd = firstBeforeLine === Infinity
        ? beforeLines.length   // expand to end of file
        : firstBeforeLine - 1
      afterMissStart = lastAfterLine + 1
      afterMissEnd = firstAfterLine === Infinity
        ? afterLines.length
        : firstAfterLine - 1
    } else {
      // "Show All" hunk-info: use diff hunk headers to compute the gap.
      // fileDiffs is keyed by file.id (e.g. "Modified+path") — match flexibly.
      let diff: ITextDiff | null = null
      for (const [key, value] of this.state.fileDiffs.entries()) {
        if (
          key === filePath ||
          key.endsWith('+' + filePath) ||
          key.endsWith('/' + filePath) ||
          key.endsWith('\\' + filePath)
        ) {
          diff = value
          break
        }
      }
      if (!diff) return

      // Find which hunk this expand button belongs to
      const allHunkWrappers = Array.from(inner.children).filter(child => {
        const el = child as HTMLElement
        if (el.classList.contains('component-hunk-separator')) return false
        if (el.classList.contains('expanded-context-row')) return false
        return el.querySelector('.hunk-info') !== null || el.classList.contains('hunk-info')
      }) as HTMLElement[]

      const hunkIndex = allHunkWrappers.indexOf(outerWrapper)
      if (hunkIndex === -1) return

      const hunk = diff.hunks[hunkIndex]
      if (!hunk) return

      if (hunkIndex === 0) {
        // First hunk — expand from line 1 to hunk start
        beforeMissStart = 1
        beforeMissEnd = hunk.header.oldStartLine - 1
        afterMissStart = 1
        afterMissEnd = hunk.header.newStartLine - 1
      } else {
        const prevHunk = diff.hunks[hunkIndex - 1]
        beforeMissStart = prevHunk.header.oldStartLine + prevHunk.header.oldLineCount
        beforeMissEnd = hunk.header.oldStartLine - 1
        afterMissStart = prevHunk.header.newStartLine + prevHunk.header.newLineCount
        afterMissEnd = hunk.header.newStartLine - 1
      }
    }

    // --- Nothing to expand? ------------------------------------------------
    if (beforeMissEnd < beforeMissStart && afterMissEnd < afterMissStart) {
      // For component separators or bottom boundary, still remove the element
      if (isComponentSeparator || isBottomBoundary) {
        if (this.mutationObserver) this.mutationObserver.disconnect()
        try {
          outerWrapper.remove()
          repackFile(fileContainer)
        } finally {
          if (this.mutationObserver) {
            const container = document.querySelector('.folder-compare-view')
            if (container) {
              this.mutationObserver.observe(container, { childList: true, subtree: true })
            }
          }
        }
      }
      return
    }

    // --- Insert context rows from source files -----------------------------
    if (this.mutationObserver) this.mutationObserver.disconnect()

    try {
      const beforeCount = Math.max(0, beforeMissEnd - beforeMissStart + 1)
      const afterCount = Math.max(0, afterMissEnd - afterMissStart + 1)
      const rowCount = Math.max(beforeCount, afterCount)

      // Get a reference row height and line-number gutter width from siblings
      const siblings = Array.from(inner.children) as HTMLElement[]
      let rowHeight = 20
      let gutterWidth = ''
      for (const sib of siblings) {
        const h = parseInt(sib.style.height || '0', 10)
        if (
          h > 0 &&
          !sib.classList.contains('component-hunk-separator') &&
          !sib.classList.contains('expanded-context-row')
        ) {
          rowHeight = h
          // Sample the gutter width from the first .line-number in this row
          if (!gutterWidth) {
            const ln = sib.querySelector('.line-number') as HTMLElement
            if (ln && ln.style.width) gutterWidth = ln.style.width
          }
          if (gutterWidth) break
        }
      }

      const fragment = document.createDocumentFragment()
      for (let i = 0; i < rowCount; i++) {
        const beforeLineNum =
          beforeMissStart + i <= beforeMissEnd ? beforeMissStart + i : null
        const afterLineNum =
          afterMissStart + i <= afterMissEnd ? afterMissStart + i : null
        const beforeContent =
          beforeLineNum !== null && beforeLineNum <= beforeLines.length
            ? beforeLines[beforeLineNum - 1] ?? ''
            : ''
        const afterContent =
          afterLineNum !== null && afterLineNum <= afterLines.length
            ? afterLines[afterLineNum - 1] ?? ''
            : ''

        const wrapper = this.createContextRowElement(
          beforeLineNum,
          afterLineNum,
          beforeContent,
          afterContent,
          rowHeight,
          gutterWidth
        )
        wrapper.classList.add('expanded-context-row')
        fragment.appendChild(wrapper)
      }

      // Insert context rows before the separator / hunk-info wrapper
      inner.insertBefore(fragment, outerWrapper)

      // Hide/remove the hunk header (for both modes)
      if (isBottomBoundary) {
        // Remove the bottom boundary expand button
        outerWrapper.remove()
      } else {
        // Hide the hunk header (component separator or Show All hunk-info)
        // so collapseExpandedRows can restore it later.
        outerWrapper.classList.add('hunk-expanded')
        outerWrapper.style.top = '-99999px'
      }

      // Re-position all rows — repackFile sets the clip-wrapper height
      // correctly.  Do NOT call shrinkWrappersToFit() here: it can recompute
      // a smaller height if RV has overwritten inline tops on a later frame.
      repackFile(fileContainer)

      // Sync expanded rows with current horizontal scroll position
      this.syncExpandedRowsScroll(fileContainer)

      // Apply syntax highlighting to the newly inserted rows.
      // We await so the observer is still disconnected during DOM changes.
      await this.highlightExpandedRows(
        fileContainer,
        filePath,
        beforeLines,
        afterLines,
        beforeMissStart,
        beforeMissEnd,
        afterMissStart,
        afterMissEnd
      ).catch(() => {})
    } finally {
      if (this.mutationObserver) {
        const container = document.querySelector('.folder-compare-view')
        if (container) {
          this.mutationObserver.observe(container, { childList: true, subtree: true })
        }
      }
    }
  }

  /**
   * Create a DOM element mimicking a side-by-side context row with the given
   * before/after line numbers and content.  Used to fill in lines between
   * diff hunks when the user clicks "Expand context".
   */
  private createContextRowElement(
    beforeLineNum: number | null,
    afterLineNum: number | null,
    beforeContent: string,
    afterContent: string,
    rowHeight: number,
    gutterWidth: string
  ): HTMLDivElement {
    const wrapper = document.createElement('div')
    wrapper.style.position = 'absolute'
    wrapper.style.width = '100%'
    wrapper.style.height = `${rowHeight}px`

    const row = document.createElement('div')
    row.className = 'context row'
    row.setAttribute('role', 'cell')
    row.style.height = '100%'

    // Before side
    const beforeSide = document.createElement('div')
    beforeSide.className = 'before'
    const beforeLineNumDiv = this.createLineNumberElement(beforeLineNum, 'before', gutterWidth)
    const beforeContentDiv = this.createContentElement(beforeContent)
    beforeSide.appendChild(beforeLineNumDiv)
    beforeSide.appendChild(beforeContentDiv)

    // After side
    const afterSide = document.createElement('div')
    afterSide.className = 'after'
    const afterLineNumDiv = this.createLineNumberElement(afterLineNum, 'after', gutterWidth)
    const afterContentDiv = this.createContentElement(afterContent)
    afterSide.appendChild(afterLineNumDiv)
    afterSide.appendChild(afterContentDiv)

    row.appendChild(beforeSide)
    row.appendChild(afterSide)
    wrapper.appendChild(row)

    // Right-click anywhere on this expanded row → show combined context menu
    wrapper.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      showContextualMenu([
        {
          label: 'Collapse',
          action: () => this.collapseExpandedRows(wrapper),
        },
        { type: 'separator' },
        { role: 'copy' },
        { role: 'selectAll' },
      ])
    })

    return wrapper
  }

  private createLineNumberElement(lineNum: number | null, side: 'before' | 'after', gutterWidth: string): HTMLDivElement {
    const div = document.createElement('div')
    div.className = 'line-number'
    if (gutterWidth) div.style.width = gutterWidth
    if (lineNum !== null) {
      const label = document.createElement('label')
      label.setAttribute('for', `${lineNum}-${side}`)
      const span = document.createElement('span')
      const srOnly = document.createElement('span')
      srOnly.className = 'sr-only'
      srOnly.textContent = 'Line '
      span.appendChild(srOnly)
      span.appendChild(document.createTextNode(String(lineNum)))
      label.appendChild(span)
      div.appendChild(label)
    }
    return div
  }

  private createContentElement(text: string): HTMLDivElement {
    const contentDiv = document.createElement('div')
    contentDiv.className = 'content'
    const prefix = document.createElement('div')
    prefix.className = 'prefix'
    prefix.textContent = '\u00A0\u00A0\u00A0\u00A0\u00A0'
    const contentWrapper = document.createElement('div')
    contentWrapper.className = 'content-wrapper'
    contentWrapper.textContent = text
    contentDiv.appendChild(prefix)
    contentDiv.appendChild(contentWrapper)
    return contentDiv
  }

  /**
   * Apply the current horizontal scroll offset to newly-inserted expanded
   * context rows so they are in sync with the rest of the diff.
   */
  private syncExpandedRowsScroll(fileContainer: Element): void {
    const syncBar = fileContainer.querySelector('.scroll-sync-bar')
    if (!syncBar) return
    const bars = syncBar.children as HTMLCollectionOf<HTMLElement>
    const beforeBar = bars[0]
    const afterBar = bars[1]
    if (beforeBar) {
      const sl = beforeBar.scrollLeft
      if (sl > 0) {
        fileContainer.querySelectorAll('.expanded-context-row .before .content-wrapper').forEach(w => {
          ;(w as HTMLElement).style.transform = `translateX(-${sl}px)`
        })
      }
    }
    if (afterBar) {
      const sl = afterBar.scrollLeft
      if (sl > 0) {
        fileContainer.querySelectorAll('.expanded-context-row .after .content-wrapper').forEach(w => {
          ;(w as HTMLElement).style.transform = `translateX(-${sl}px)`
        })
      }
    }
  }

  /**
   * Apply syntax highlighting tokens to a content-wrapper DOM element.
   * Replaces the plain text node with a series of `<span class="cm-*">` elements.
   */
  private applyTokensToContentWrapper(
    contentWrapper: HTMLElement,
    lineTokens: ILineTokens
  ): void {
    const text = contentWrapper.textContent || ''
    if (!text) return

    // Build sorted list of token start positions
    const positions = Object.keys(lineTokens)
      .map(Number)
      .sort((a, b) => a - b)

    if (positions.length === 0) return

    contentWrapper.textContent = ''
    let cursor = 0

    for (const pos of positions) {
      const token = lineTokens[pos]
      if (!token || token.length === 0) continue

      // Plain text before this token
      if (pos > cursor) {
        contentWrapper.appendChild(
          document.createTextNode(text.substring(cursor, pos))
        )
      }

      // The token span
      const end = Math.min(pos + token.length, text.length)
      const span = document.createElement('span')
      span.className = token.token
        .split(' ')
        .map(t => `cm-${t}`)
        .join(' ')
      span.textContent = text.substring(pos, end)
      contentWrapper.appendChild(span)
      cursor = end
    }

    // Trailing plain text
    if (cursor < text.length) {
      contentWrapper.appendChild(
        document.createTextNode(text.substring(cursor))
      )
    }
  }

  /**
   * Run syntax highlighting on expanded context rows for a specific file.
   * Reads file contents from the fileContentsMap, calls the highlight worker,
   * then applies tokens to each expanded row's content-wrappers.
   */
  private async highlightExpandedRows(
    fileContainer: HTMLElement,
    filePath: string,
    beforeLines: string[],
    afterLines: string[],
    beforeMissStart: number,
    beforeMissEnd: number,
    afterMissStart: number,
    afterMissEnd: number
  ): Promise<void> {
    const basename = Path.basename(filePath)
    const extension = Path.extname(filePath)
    const tabSize = 4

    // Build line filters for the ranges we need
    const beforeLineFilter: number[] = []
    for (let i = beforeMissStart; i <= beforeMissEnd; i++) {
      if (i > 0 && i <= beforeLines.length) beforeLineFilter.push(i - 1)
    }
    const afterLineFilter: number[] = []
    for (let i = afterMissStart; i <= afterMissEnd; i++) {
      if (i > 0 && i <= afterLines.length) afterLineFilter.push(i - 1)
    }

    // Run highlighting in parallel for both sides
    const [beforeTokens, afterTokens] = await Promise.all([
      beforeLineFilter.length > 0
        ? highlight(beforeLines, basename, extension, tabSize, beforeLineFilter)
            .catch(() => ({} as ITokens))
        : Promise.resolve({} as ITokens),
      afterLineFilter.length > 0
        ? highlight(afterLines, basename, extension, tabSize, afterLineFilter)
            .catch(() => ({} as ITokens))
        : Promise.resolve({} as ITokens),
    ])

    // Apply tokens to each expanded-context-row in this file container
    const expandedRows = fileContainer.querySelectorAll('.expanded-context-row')
    for (const row of Array.from(expandedRows)) {
      // Before side
      const beforeLabel = row.querySelector('.before .line-number label')
      if (beforeLabel) {
        const forAttr = beforeLabel.getAttribute('for') || ''
        const lineNum = parseInt(forAttr.split('-')[0], 10)
        if (!isNaN(lineNum) && beforeTokens[lineNum - 1]) {
          const cw = row.querySelector('.before .content-wrapper') as HTMLElement
          if (cw) this.applyTokensToContentWrapper(cw, beforeTokens[lineNum - 1])
        }
      }
      // After side
      const afterLabel = row.querySelector('.after .line-number label')
      if (afterLabel) {
        const forAttr = afterLabel.getAttribute('for') || ''
        const lineNum = parseInt(forAttr.split('-')[0], 10)
        if (!isNaN(lineNum) && afterTokens[lineNum - 1]) {
          const cw = row.querySelector('.after .content-wrapper') as HTMLElement
          if (cw) this.applyTokensToContentWrapper(cw, afterTokens[lineNum - 1])
        }
      }
    }
  }

  /**
   * Collapse (remove) all expanded-context-row elements that belong to the
   * same expansion group as the right-clicked row, and restore the hunk header.
   */
  private collapseExpandedRows(clickedRow: HTMLElement): void {
    const inner = clickedRow.closest(
      '.ReactVirtualized__Grid__innerScrollContainer'
    ) as HTMLElement
    if (!inner) return
    const fileContainer = clickedRow.closest('[data-file-path]') as HTMLElement
    if (!fileContainer) return

    // Cancel any active shrink polling so it cannot overwrite heights
    if (this.shrinkPollingRAF !== null) {
      cancelAnimationFrame(this.shrinkPollingRAF)
      this.shrinkPollingRAF = null
    }

    // Disconnect MutationObserver during DOM manipulation
    if (this.mutationObserver) this.mutationObserver.disconnect()

    try {
      // Find the contiguous block of expanded-context-rows around clickedRow
      const children = Array.from(inner.children) as HTMLElement[]
      const idx = children.indexOf(clickedRow)
      if (idx === -1) return

      let startIdx = idx
      while (startIdx > 0 && children[startIdx - 1].classList.contains('expanded-context-row')) {
        startIdx--
      }
      let endIdx = idx
      while (endIdx < children.length - 1 && children[endIdx + 1].classList.contains('expanded-context-row')) {
        endIdx++
      }

      // The hunk header that was hidden is immediately after the block
      const hunkWrapper = children[endIdx + 1]

      // Remove all expanded-context-row elements in this block
      for (let i = endIdx; i >= startIdx; i--) {
        children[i].remove()
      }

      // Restore the hunk header if it was hidden
      if (hunkWrapper && hunkWrapper.classList.contains('hunk-expanded')) {
        hunkWrapper.classList.remove('hunk-expanded')
        hunkWrapper.style.top = '' // will be re-positioned by repackFile
        const btn = hunkWrapper.querySelector('.expand-context-btn') as HTMLElement
        if (btn) btn.style.display = ''
      }

      repackFile(fileContainer)

      // Re-inject boundary expand buttons (in case a bottom boundary was collapsed)
      injectBoundaryExpandButtons(this.state.beforeFolder, this.state.afterFolder)
    } finally {
      if (this.mutationObserver) {
        const container = document.querySelector('.folder-compare-view')
        if (container) {
          this.mutationObserver.observe(container, { childList: true, subtree: true })
        }
      }
    }
  }

  /**
   * After component highlighting has been applied, detect lines that the
   * component spans but that fall in inter-hunk gaps (not present in any
   * diff hunk, thus no DOM row exists).  Read source files and insert
   * styled context rows so the full component span is visible.
   */
  private async insertMissingComponentLines(): Promise<void> {
    const sel = this.state.selectedComponent
    if (sel === 'all' || sel === 'misc') return

    for (const file of this.state.fileChanges) {
      const filePath = file.path
      const highlights = getHighlightedLinesForComponent(
        this.state.diffComponents, sel, filePath, this.state.diffNodes
      )
      if (highlights.length === 0) continue

      const fileContainer = document.querySelector(
        `.folder-compare-view [data-file-path="${filePath}"]`
      )
      if (!fileContainer) continue
      if (fileContainer.classList.contains('component-file-hidden')) continue

      const inner = fileContainer.querySelector(
        '.ReactVirtualized__Grid__innerScrollContainer'
      ) as HTMLElement
      if (!inner) continue

      // Collect needed line numbers per side
      const neededAfter = new Set<number>()
      const neededBefore = new Set<number>()
      for (const h of highlights) {
        if (h.side === 'after') neededAfter.add(h.line)
        else neededBefore.add(h.line)
      }
      if (neededAfter.size === 0 && neededBefore.size === 0) continue

      // Check which lines are already present in existing DOM rows
      const presentAfter = new Set<number>()
      const presentBefore = new Set<number>()
      const allChildren = Array.from(inner.children) as HTMLElement[]
      for (const child of allChildren) {
        if (child.classList.contains('component-hunk-separator')) continue
        if (child.classList.contains('expand-boundary-bottom')) continue
        const row = (child.querySelector('.row') as HTMLElement) ?? child
        const adiv = row.querySelector('.after .line-number')
        const bdiv = row.querySelector('.before .line-number')
        if (adiv) {
          const a = extractLineNumber(adiv)
          if (a !== null) presentAfter.add(a)
        }
        if (bdiv) {
          const b = extractLineNumber(bdiv)
          if (b !== null) presentBefore.add(b)
        }
      }

      const missingAfter: number[] = []
      for (const line of neededAfter) {
        if (!presentAfter.has(line)) missingAfter.push(line)
      }
      if (missingAfter.length === 0) continue

      // Read source files
      const afterFilePath = Path.join(this.state.afterFolder, filePath)
      const beforeFilePath = Path.join(this.state.beforeFolder, filePath)
      let afterFileLines: string[] = []
      let beforeFileLines: string[] = []
      try { afterFileLines = (await FSPromises.readFile(afterFilePath, 'utf-8')).split('\n') } catch {}
      try { beforeFileLines = (await FSPromises.readFile(beforeFilePath, 'utf-8')).split('\n') } catch {}

      // Guard: if component selection changed while reading files, bail out
      if (this.state.selectedComponent !== sel) return

      // Get diff hunk data for before↔after line mapping
      let diff: ITextDiff | null = null
      for (const [key, value] of this.state.fileDiffs.entries()) {
        if (key === filePath || key.endsWith('+' + filePath) ||
            key.endsWith('/' + filePath) || key.endsWith('\\' + filePath)) {
          diff = value
          break
        }
      }

      // Helper: compute before-line for a given after-line using hunk offsets
      const computeBeforeLine = (afterLine: number): number | null => {
        if (!diff || diff.hunks.length === 0) return afterLine
        for (let i = 0; i < diff.hunks.length; i++) {
          const hunk = diff.hunks[i]
          if (hunk.header.newStartLine > afterLine) {
            if (i === 0) {
              const offset = hunk.header.newStartLine - hunk.header.oldStartLine
              const bl = afterLine - offset
              return bl < 1 ? afterLine : bl
            } else {
              const prevHunk = diff.hunks[i - 1]
              const prevOldEnd = prevHunk.header.oldStartLine + prevHunk.header.oldLineCount - 1
              const prevNewEnd = prevHunk.header.newStartLine + prevHunk.header.newLineCount - 1
              return afterLine - (prevNewEnd - prevOldEnd)
            }
          }
        }
        const lastHunk = diff.hunks[diff.hunks.length - 1]
        const lastOldEnd = lastHunk.header.oldStartLine + lastHunk.header.oldLineCount - 1
        const lastNewEnd = lastHunk.header.newStartLine + lastHunk.header.newLineCount - 1
        return afterLine - (lastNewEnd - lastOldEnd)
      }

      // Get row dimensions from existing rows
      let rowHeight = 20
      let gutterWidth = ''
      for (const child of allChildren) {
        const h = parseInt(child.style.height || '0', 10)
        if (h > 0 && !child.classList.contains('component-hunk-separator') &&
            !child.classList.contains('expanded-context-row')) {
          rowHeight = h
          if (!gutterWidth) {
            const ln = child.querySelector('.line-number') as HTMLElement
            if (ln && ln.style.width) gutterWidth = ln.style.width
          }
          if (gutterWidth) break
        }
      }

      // Sort missing component lines
      missingAfter.sort((a, b) => a - b)

      // Find the last present after-line before the first missing line
      // to determine the gap that needs context lines
      const firstMissing = missingAfter[0]
      let lastPresentBeforeGap = 0
      for (const line of presentAfter) {
        if (line < firstMissing && line > lastPresentBeforeGap) {
          lastPresentBeforeGap = line
        }
      }

      // Build the full list of lines to insert: gap context + component lines
      const allLinesToInsert: Array<{ afterLine: number; isComponent: boolean }> = []

      // Fill the gap between last present line and first missing component line
      // Limit to at most CONTEXT lines before the first component line.
      const CONTEXT = 3
      if (lastPresentBeforeGap > 0 && firstMissing - lastPresentBeforeGap > 1) {
        const contextStart = Math.max(lastPresentBeforeGap + 1, firstMissing - CONTEXT)
        for (let l = contextStart; l < firstMissing; l++) {
          if (!presentAfter.has(l)) {
            allLinesToInsert.push({ afterLine: l, isComponent: false })
          }
        }
      }

      // Add missing component lines
      for (const line of missingAfter) {
        allLinesToInsert.push({ afterLine: line, isComponent: true })
      }

      // Track ranges of inserted lines for syntax highlighting
      let insertedAfterMin = Infinity
      let insertedAfterMax = 0
      let insertedBeforeMin = Infinity
      let insertedBeforeMax = 0

      for (const { afterLine, isComponent } of allLinesToInsert) {
        const beforeLine = computeBeforeLine(afterLine)

        const afterContent = afterLine <= afterFileLines.length
          ? afterFileLines[afterLine - 1] ?? '' : ''
        const beforeContent = beforeLine !== null && beforeLine > 0 && beforeLine <= beforeFileLines.length
          ? beforeFileLines[beforeLine - 1] ?? '' : ''

        const wrapper = this.createContextRowElement(
          beforeLine !== null && beforeLine > 0 ? beforeLine : null,
          afterLine,
          beforeContent,
          afterContent,
          rowHeight,
          gutterWidth
        )
        wrapper.classList.add('expanded-context-row', 'component-auto-expanded')

        // Style for component view: give the row a green (addition)
        // background so it's clearly part of the selected component.
        const row = wrapper.querySelector('.row') as HTMLElement
        if (row) {
          const beforeSide = row.querySelector('.before') as HTMLElement
          const afterSide = row.querySelector('.after') as HTMLElement
          if (isComponent) {
            if (afterSide) {
              afterSide.classList.add('component-context-addition')
            }
            if (beforeSide) beforeSide.classList.add('component-filtered-side')
          }
        }

        // Track ranges for syntax highlighting
        if (afterLine < insertedAfterMin) insertedAfterMin = afterLine
        if (afterLine > insertedAfterMax) insertedAfterMax = afterLine
        if (beforeLine !== null && beforeLine > 0) {
          if (beforeLine < insertedBeforeMin) insertedBeforeMin = beforeLine
          if (beforeLine > insertedBeforeMax) insertedBeforeMax = beforeLine
        }

        // Find insertion point: before the first non-separator child
        // whose after-side line number is greater than our target
        const currentChildren = Array.from(inner.children) as HTMLElement[]
        let insertBeforeEl: HTMLElement | null = null
        for (const child of currentChildren) {
          if (child.classList.contains('component-hunk-separator')) continue
          if (child.classList.contains('expand-boundary-bottom')) continue
          const r = (child.querySelector('.row') as HTMLElement) ?? child
          const adiv = r.querySelector('.after .line-number')
          if (adiv) {
            const a = extractLineNumber(adiv)
            if (a !== null && a > afterLine) {
              insertBeforeEl = child
              break
            }
          }
        }

        if (insertBeforeEl) {
          inner.insertBefore(wrapper, insertBeforeEl)
        } else {
          inner.appendChild(wrapper)
        }
      }

      // Repack the file and sync scroll positions
      repackFile(fileContainer)
      this.syncExpandedRowsScroll(fileContainer)

      // Apply syntax highlighting to all auto-inserted rows
      if (insertedAfterMax >= insertedAfterMin) {
        await this.highlightExpandedRows(
          fileContainer as HTMLElement,
          filePath,
          beforeFileLines,
          afterFileLines,
          insertedBeforeMin <= insertedBeforeMax ? insertedBeforeMin : 0,
          insertedBeforeMin <= insertedBeforeMax ? insertedBeforeMax : -1,
          insertedAfterMin,
          insertedAfterMax
        ).catch(() => {})
      }
    }
  }
}
