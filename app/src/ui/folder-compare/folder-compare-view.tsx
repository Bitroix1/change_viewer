import * as React from 'react'
import * as Path from 'path'
import * as FSPromises from 'fs/promises'
import { Button } from '../lib/button'
import { Dispatcher } from '../dispatcher'
import { FolderSelector } from './folder-selector'
import { WorkingDirectoryFileChange } from '../../models/status'
import { AppFileStatusKind } from '../../models/status'
import { ITextDiff, ImageDiffType } from '../../models/diff'
import { Diff } from '../diff'
import { Repository } from '../../models/repository'
import { DiffSearchInput } from '../diff/diff-search-input'
import { showContextualMenu } from '../../lib/menu-item'

// -- Helper modules ----------------------------------------------------------
import {
  applyComponentHighlightingToAll,
  extractLineNumber,
  injectExpandButtonsIntoHunkInfoRows,
  injectBoundaryExpandButtons,
} from './folder-compare-highlight'
import { repackFile, shrinkWrappersToFit, setupScrollSync } from './folder-compare-repack'
import {
  loadDiffComponents,
  loadAllDiffs,
  compareDirectories,
  getSourceLineContent,
} from './folder-compare-data'

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
const DEFAULT_LEFT_TOP_FRACTION = 0.55

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
      collapsedFolders: [],
      hunkEntries: [],
      selectedRightPanelLine: null,
      leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
      rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
      leftTopFraction: DEFAULT_LEFT_TOP_FRACTION,
      isSearching: false,
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

    const hasLeftPanel = this.state.diffComponents.length > 0
    const hasRightPanel = this.state.selectedComponent !== 'all' && this.state.selectedComponent !== 'misc'

    return (
      <div className="folder-compare-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
              `}</style>
              {/* Scrollable top section: component list */}
              <div style={{ flex: `0 0 ${this.state.leftTopFraction * 100}%`, display: 'flex', flexDirection: 'column', padding: '15px', minHeight: `${MIN_LEFT_TOP_HEIGHT}px`, overflow: 'hidden' }}>
              <h3 style={{ margin: '0 0 15px 0', fontSize: '14px', fontWeight: 600 }}>Diff View Options</h3>
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
                <div style={{ flex: 1, overflow: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
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
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })
                })()}
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '4px',
                  marginTop: '6px',
                  position: 'sticky',
                  bottom: 0,
                  backgroundColor: this.state.selectedComponent === 'misc' ? 'var(--box-border-color)' : 'var(--background-color)'
                }}>
                  <input
                    type="radio"
                    name="component-view"
                    value="misc"
                    checked={this.state.selectedComponent === 'misc'}
                    onChange={this.onComponentChange}
                  />
                  <span style={{ fontSize: '13px' }}>Miscellaneous</span>
                </label>
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
                <h3 style={{ margin: '0 0 15px 0', fontSize: '14px', fontWeight: 600 }}>
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
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary-color)' }}>
                    {this.state.fileChanges.length} changed {this.state.fileChanges.length === 1 ? 'file' : 'files'}
                  </span>
                )}
              </div>
            </div>

            {this.state.isSearching && (
              <div style={{
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
                  style={{ fontSize: '12px', color: 'var(--text-secondary-color)', whiteSpace: 'nowrap' }}
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
          fileContents={null}
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
            background: var(--diff-hover-background-color);
            color: var(--diff-hover-text-color);
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
            margin-top: 0 !important;
            margin-bottom: 0 !important;
            padding: 0 !important;
            border: none !important;
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
    document.addEventListener('expand-hunk-context', this.onExpandHunkContext as unknown as EventListener, true)
  }

  public componentDidUpdate(prevProps: IFolderCompareViewProps, prevState: IFolderCompareViewState): void {
    // Apply highlighting when component selection changes
    if (prevState.selectedComponent !== this.state.selectedComponent) {
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
      requestAnimationFrame(() => {
        this.applyAndRepackAll()
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
        })
      })
    }

    // Set up MutationObserver when diff content first appears
    if (!this.mutationObserver && !this.state.showFolderSelector && this.state.fileChanges.length > 0 && !this.state.isLoadingDiffs) {
      this.setupMutationObserver()
    }

    // When the search bar opens or closes the content area height changes;
    // re-shrink wrappers so no extra space appears.
    if (prevState.isSearching !== this.state.isSearching) {
      requestAnimationFrame(() => shrinkWrappersToFit())
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
    document.removeEventListener('expand-hunk-context', this.onExpandHunkContext as unknown as EventListener, true)
    this.clearSearchHighlight()
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
          if (typeof el.classList !== 'undefined' &&
            (el.classList.contains('component-hunk-separator') ||
             el.classList.contains('component-char-highlight') ||
             el.classList.contains('component-char-click-capture') ||
             el.classList.contains('folder-search-mark') ||
             el.classList.contains('expand-context-btn') ||
             el.classList.contains('expand-context-icon') ||
             el.classList.contains('expanded-context-row') ||
             el.classList.contains('expand-boundary-bottom')))
            return true
          // Text nodes created/removed by search mark insertion/removal
          if (n.nodeType === Node.TEXT_NODE) {
            const p = n.parentElement
            if (p && p.classList.contains('content-wrapper')) return true
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
        // Re-inject expand buttons into restored hunk-info rows
        injectExpandButtonsIntoHunkInfoRows()
        // Re-inject boundary expand buttons at bottom of each file
        injectBoundaryExpandButtons(this.state.beforeFolder, this.state.afterFolder)
      } else {
        for (const file of this.state.fileChanges) {
          const fc = document.querySelector(
            `.folder-compare-view [data-file-path="${file.path}"]`
          )
          if (fc) repackFile(fc)
        }
        // Inject boundary expand buttons at bottom of each file (component mode)
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
    const isVisible =
      elRect.top >= containerRect.top &&
      elRect.bottom <= containerRect.bottom
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
      const line = parseInt(parts[0], 10)
      const colParts = parts[1].split('-')
      const startCol = parseInt(colParts[0], 10)
      const side: 'before' | 'after' = node.kind === 'Removal' ? 'before' : 'after'
      const key = `${node.file}:${line}:${side}`

      const existing = lineMap.get(key)
      if (!existing) {
        lineMap.set(key, {
          file: node.file,
          line,
          startCol,
          side,
          reachable_by: node.reachable_by ?? 0
        })
      } else {
        // Keep earliest startCol
        if (startCol < existing.startCol) {
          existing.startCol = startCol
        }
        // Keep max reachable_by
        if ((node.reachable_by ?? 0) > existing.reachable_by) {
          existing.reachable_by = node.reachable_by
        }
      }
    }

    // Sort by reachable_by descending
    const entries = Array.from(lineMap.entries())
      .sort((a, b) => b[1].reachable_by - a[1].reachable_by)

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

    return entries.map(([key, entry]) => {
      // Get full line content (without diff prefix, since DiffLine.content strips it)
      const rawContent = getSourceLineContent(
        entry.file, entry.line, entry.side, this.state.fileDiffs
      )
      // Strip leading whitespace first, then apply any remaining startCol
      // offset (startCol typically equals the indentation level, so for most
      // lines trimStart + a small remaining offset gives the code starting
      // at the precise change position).
      const trimmed = rawContent.trimStart()
      const leadingWS = rawContent.length - trimmed.length
      const remainingCol = Math.max(0, entry.startCol - leadingWS)
      const displayContent = trimmed.substring(remainingCol)
      return {
        key,
        ...entry,
        fullPath: resolveFullPath(entry.file),
        content: displayContent || '(empty)'
      }
    })
  }

  /**
   * Right panel: shows all changed lines in the component, sorted by
   * reachable_by score. Always visible when a component is selected.
   */
  private renderRightPanel(): JSX.Element | null {
    if (this.state.selectedComponent === 'all' || this.state.selectedComponent === 'misc') return null

    const entries = this.computeRightPanelEntries()

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
      <div style={{
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
          <div style={{ fontSize: '11px', color: 'var(--text-secondary-color)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {kindLabel}
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-color)' }}>
            {componentName}
          </div>
        </div>

        <h3 style={{ margin: '0 0 15px 0', fontSize: '14px', fontWeight: 600 }}>
          Changed Lines ({entries.length})
        </h3>

        {entries.length === 0 && (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary-color)', fontStyle: 'italic' }}>
            No changed lines
          </div>
        )}

        {(() => {
          // Determine the unique max reachable_by for the "Likely source" badge
          const maxReachable = entries.length > 0
            ? Math.max(...entries.map(e => e.reachable_by))
            : 0
          const maxCount = entries.filter(e => e.reachable_by === maxReachable).length
          const likelySourceKey = maxReachable > 0 && maxCount === 1
            ? entries.find(e => e.reachable_by === maxReachable)!.key
            : null

          return entries.map(entry => {
            const isSelected = this.state.selectedRightPanelLine === entry.key
            const isLikelySource = entry.key === likelySourceKey
            return (
              <div key={entry.key} className="right-panel-entry" style={{
                fontSize: '11px',
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
                  fontSize: '11px',
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
                    <span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{entry.fullPath}:{entry.line} ({entry.side === 'before' ? '-' : '+'})</span>
                  </span>
                  {isLikelySource && (
                    <span style={{
                      color: '#d4a017',
                      fontWeight: 700,
                      fontSize: '10px',
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
                  fontSize: '12px'
                }}>
                  {entry.content}
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
      selectedComponent: value === 'all' ? 'all' : value === 'misc' ? 'misc' : parseInt(value, 10),
      selectedNodeInfo: null,
      hunkEntries: [],
      selectedRightPanelLine: null,
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
            fontSize: '12px',
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
            fontSize: '8px',
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
            fontSize: '12px',
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
    this.clearSearchHighlight()
    this.folderSearchMatches = []
    this.folderSearchIndex = -1
    this.folderSearchQuery = ''
    this.setState({ isSearching: false })
  }

  private onFolderSearch = (query: string, direction: 'next' | 'previous') => {
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
    if (this.folderSearchIndex >= 0) {
      this.highlightSearchMatch(this.folderSearchIndex)
    }
    this.updateSearchCountDisplay()
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
    document
      .querySelectorAll('.folder-compare-view .folder-search-mark')
      .forEach(mark => {
        const parent = mark.parentNode
        if (parent) {
          parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
          parent.normalize() // merge adjacent text nodes
        }
      })
  }

  /**
   * Highlight the Nth occurrence of the search query inside the content-wrapper
   * on the given side by wrapping it in a <mark> element with an orange
   * background.  Only the word itself is highlighted, not the whole line.
   */
  private highlightSearchMatch(index: number): void {
    const match = this.folderSearchMatches[index]
    if (!match) return
    const { row, side, occurrence } = match
    this.scrollIntoViewIfNeeded(row, 'center')

    const cw = row.querySelector(`.${side} .content-wrapper`) as HTMLElement
    if (!cw) return

    const query = this.folderSearchQuery.toLowerCase()
    const queryLen = this.folderSearchQuery.length

    // Walk text nodes (same filter as getSearchableText) and find the
    // Nth (occurrence) match of the query string.
    const walker = document.createTreeWalker(
      cw,
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

    let seen = 0
    let textNode: Text | null
    while ((textNode = walker.nextNode() as Text | null)) {
      const nodeText = textNode.textContent || ''
      let searchFrom = 0
      while (true) {
        const idx = nodeText.toLowerCase().indexOf(query, searchFrom)
        if (idx === -1) break
        if (seen === occurrence) {
          // Split the text node and wrap the match in a <mark>
          const matchStart = textNode.splitText(idx)
          const afterMatch = matchStart.splitText(queryLen)
          void afterMatch // stays in DOM

          const mark = document.createElement('mark')
          mark.className = 'folder-search-mark'
          mark.style.backgroundColor = 'rgba(255, 165, 0, 0.6)'
          mark.style.color = 'inherit'
          mark.style.borderRadius = '2px'
          mark.style.padding = '0'
          mark.textContent = matchStart.textContent
          matchStart.parentNode!.replaceChild(mark, matchStart)
          return
        }
        seen++
        searchFrom = idx + queryLen
      }
    }
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
      } else if (isComponentSeparator) {
        outerWrapper.remove()
      } else {
        // Hide the entire hunk-info wrapper (not just the expand button)
        outerWrapper.classList.add('hunk-expanded')
        outerWrapper.style.top = '-99999px'
      }

      // Re-position all rows — repackFile sets the clip-wrapper height
      // correctly.  Do NOT call shrinkWrappersToFit() here: it can recompute
      // a smaller height if RV has overwritten inline tops on a later frame.
      repackFile(fileContainer)

      // Sync expanded rows with current horizontal scroll position
      this.syncExpandedRowsScroll(fileContainer)
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
}
