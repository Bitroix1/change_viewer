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
            <div className="folder-compare-header" style={{ padding: '10px', borderBottom: '1px solid var(--box-border-color)' }}>
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
                <div key={file.id} style={{ 
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
            color: var(--text-secondary-color) !important;
            background-color: var(--background-color) !important;
          }
          
          .folder-compare-view .component-filtered .line-number.line-selected,
          .folder-compare-view .component-filtered-side .line-number.line-selected {
            background-color: var(--background-color) !important;
          }
          
          .folder-compare-view .component-filtered .content,
          .folder-compare-view .component-filtered .content-wrapper,
          .folder-compare-view .component-filtered-side .content,
          .folder-compare-view .component-filtered-side .content-wrapper {
            background-color: var(--background-color) !important;
            color: var(--text-secondary-color) !important;
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
            color: var(--text-secondary-color) !important;
          }
          
          .folder-compare-view .component-filtered .diff-line-gutter,
          .folder-compare-view .component-filtered-side .diff-line-gutter {
            background-color: transparent !important;
          }
          
          .folder-compare-view .component-filtered *,
          .folder-compare-view .component-filtered-side * {
            color: var(--text-secondary-color) !important;
          }
        `}</style>
      </div>
    )
  }

  public componentDidUpdate(prevProps: IFolderCompareViewProps, prevState: IFolderCompareViewState): void {
    // Apply highlighting when component selection changes
    if (prevState.selectedComponent !== this.state.selectedComponent) {
      // Use setTimeout to ensure DOM has been updated
      setTimeout(() => this.applyComponentHighlightingToAll(), 0)
    }
  }

  private applyComponentHighlightingToAll(): void {
    // Apply highlighting to all displayed files
    for (const file of this.state.fileChanges) {
      this.applyComponentHighlightingForFile(file.path)
    }
  }

  private applyComponentHighlightingForFile(filePath: string): void {
    console.log('[DOM Highlighter] Starting for file:', filePath)
    console.log('[DOM Highlighter] Selected component:', this.state.selectedComponent)
    
    // If "Show All" is selected, remove all filtering
    if (this.state.selectedComponent === 'all') {
      console.log('[DOM Highlighter] Show All - removing all filters')
      document.querySelectorAll('.folder-compare-view .row').forEach(row => {
        row.classList.remove('component-filtered')
      })
      document.querySelectorAll('.folder-compare-view .before, .folder-compare-view .after').forEach(side => {
        side.classList.remove('component-filtered-side')
      })
      return
    }
    
    const highlightedLines = this.getHighlightedLinesForComponent(filePath)
    console.log('[DOM Highlighter] File:', filePath)
    console.log('[DOM Highlighter] Highlighted lines:', highlightedLines)
    
    // Debug: Let's inspect what's actually in the DOM
    console.log('[DOM Highlighter] Checking DOM structure...')
    const folderCompareView = document.querySelector('.folder-compare-view')
    console.log('[DOM Highlighter] .folder-compare-view found:', !!folderCompareView)
    
    const allDivs = document.querySelectorAll('.folder-compare-view div')
    console.log('[DOM Highlighter] Total divs in folder-compare-view:', allDivs.length)
    
    const rowsWithClass = document.querySelectorAll('.folder-compare-view .row')
    console.log('[DOM Highlighter] Rows with .row class:', rowsWithClass.length)
    
    // Try different selectors
    const addedRows = document.querySelectorAll('.folder-compare-view .added')
    const deletedRows = document.querySelectorAll('.folder-compare-view .deleted')
    console.log('[DOM Highlighter] Rows with .added class:', addedRows.length)
    console.log('[DOM Highlighter] Rows with .deleted class:', deletedRows.length)
    
    // Try without the folder-compare-view prefix
    const allRowsInDoc = document.querySelectorAll('.row')
    console.log('[DOM Highlighter] All .row elements in document:', allRowsInDoc.length)
    
    // Inspect the first few rows to see their actual structure
    if (allRowsInDoc.length > 0) {
      console.log('[DOM Highlighter] Inspecting all row classes:')
      allRowsInDoc.forEach((row, index) => {
        const htmlRow = row as HTMLElement
        console.log(`[DOM Highlighter]   Row ${index}: classes="${htmlRow.className}"`)
      })
      
      // Find the first modified row and inspect its structure
      const firstModified = Array.from(allRowsInDoc).find(r => (r as HTMLElement).classList.contains('modified')) as HTMLElement
      if (firstModified) {
        console.log('[DOM Highlighter] First modified row HTML:', firstModified.outerHTML.substring(0, 500))
        
        // Try to find line number elements
        const beforeSide = firstModified.querySelector('.before')
        const afterSide = firstModified.querySelector('.after')
        console.log('[DOM Highlighter] Has .before element:', !!beforeSide)
        console.log('[DOM Highlighter] Has .after element:', !!afterSide)
        
        if (beforeSide) {
          console.log('[DOM Highlighter] .before HTML:', beforeSide.outerHTML.substring(0, 300))
        }
      }
    }
    
    if (highlightedLines.length === 0) {
      console.log('[DOM Highlighter] No lines to highlight - filtering all changes')
      // If no lines to highlight for this file, mark all changed lines as filtered
      document.querySelectorAll('.folder-compare-view .row').forEach(row => {
        const htmlRow = row as HTMLElement
        if (htmlRow.classList.contains('added') || 
            htmlRow.classList.contains('deleted') || 
            htmlRow.classList.contains('modified')) {
          htmlRow.classList.add('component-filtered')
        }
      })
      return
    }
    
    const beforeLines = new Set(highlightedLines.filter(l => l.side === 'before').map(l => l.line))
    const afterLines = new Set(highlightedLines.filter(l => l.side === 'after').map(l => l.line))
    
    console.log('[DOM Highlighter] Before lines to keep:', Array.from(beforeLines))
    console.log('[DOM Highlighter] After lines to keep:', Array.from(afterLines))
    
    // Find all diff rows and check their line numbers
    const diffRows = document.querySelectorAll('.folder-compare-view .row')
    console.log('[DOM Highlighter] Total rows found:', diffRows.length)
    
    let processedCount = 0
    let filteredCount = 0
    let keptCount = 0
    
    diffRows.forEach(row => {
      const htmlRow = row as HTMLElement
      
      // Skip if not a modified/added/deleted row (skip context and hunk-info rows)
      if (!htmlRow.classList.contains('modified') && 
          !htmlRow.classList.contains('added') && 
          !htmlRow.classList.contains('deleted')) {
        return
      }
      
      processedCount++
      let shouldKeepBeforeSide = false
      let shouldKeepAfterSide = false
      
      // Check before (left) side - extract line number from id attribute
      const beforeLineNumDiv = htmlRow.querySelector('.before .line-number')
      if (beforeLineNumDiv) {
        const id = beforeLineNumDiv.getAttribute('id') // e.g., "line-numbers-3-before"
        if (id) {
          const match = id.match(/line-numbers-(\d+)-before/)
          const lineNumber = match ? parseInt(match[1], 10) : null
          console.log('[DOM Highlighter] Row has before line number:', lineNumber)
          if (lineNumber && beforeLines.has(lineNumber)) {
            shouldKeepBeforeSide = true
            console.log('[DOM Highlighter]   -> KEEPING before side (line', lineNumber, 'is in set)')
          }
        }
      }
      
      // Check after (right) side - extract line number from id attribute
      const afterLineNumDiv = htmlRow.querySelector('.after .line-number')
      if (afterLineNumDiv) {
        const id = afterLineNumDiv.getAttribute('id') // e.g., "line-numbers-3-after"
        if (id) {
          const match = id.match(/line-numbers-(\d+)-after/)
          const lineNumber = match ? parseInt(match[1], 10) : null
          console.log('[DOM Highlighter] Row has after line number:', lineNumber)
          if (lineNumber && afterLines.has(lineNumber)) {
            shouldKeepAfterSide = true
            console.log('[DOM Highlighter]   -> KEEPING after side (line', lineNumber, 'is in set)')
          }
        }
      }
      
      // Apply filtering to individual sides
      const beforeSide = htmlRow.querySelector('.before') as HTMLElement
      const afterSide = htmlRow.querySelector('.after') as HTMLElement
      
      if (beforeSide) {
        if (shouldKeepBeforeSide) {
          beforeSide.classList.remove('component-filtered-side')
          console.log('[DOM Highlighter]   -> Before side KEPT')
        } else {
          beforeSide.classList.add('component-filtered-side')
          filteredCount++
          console.log('[DOM Highlighter]   -> Before side FILTERED')
        }
      }
      
      if (afterSide) {
        if (shouldKeepAfterSide) {
          afterSide.classList.remove('component-filtered-side')
          console.log('[DOM Highlighter]   -> After side KEPT')
        } else {
          afterSide.classList.add('component-filtered-side')
          filteredCount++
          console.log('[DOM Highlighter]   -> After side FILTERED')
        }
      }
      
      // If both sides are filtered, mark the entire row as filtered too
      if (!shouldKeepBeforeSide && !shouldKeepAfterSide) {
        htmlRow.classList.add('component-filtered')
        console.log('[DOM Highlighter]   -> Entire row FILTERED')
      } else {
        htmlRow.classList.remove('component-filtered')
        keptCount++
      }
    })
    
    console.log('[DOM Highlighter] Summary: processed', processedCount, 'rows, kept', keptCount, 'filtered', filteredCount)
  }

  private getHighlightedLinesForComponent(filePath: string): Array<{line: number, side: 'before' | 'after'}> {
    if (this.state.selectedComponent === 'all') {
      console.log('[Component Filter] Show All selected - no filtering')
      return []
    }

    const component = this.state.diffComponents[this.state.selectedComponent as number]
    if (!component || !component.changes) {
      console.log('[Component Filter] No component or changes found')
      return []
    }

    console.log('[Component Filter] Selected component:', this.state.selectedComponent)
    console.log('[Component Filter] Component data:', component)
    console.log('[Component Filter] File path:', filePath)
    console.log('[Component Filter] Total changes in component:', component.changes.length)

    const lines: Array<{line: number, side: 'before' | 'after'}> = []
    const lineSet = new Set<string>() // To avoid duplicates
    
    let changeIndex = 0
    for (const change of component.changes) {
      changeIndex++
      const kind = change.kind // "Removal" or "Addition"
      
      // Process "from" field (before side for Removal, after side for Addition)
      if (change.from && change.from.file === filePath && change.from.position) {
        const lineNum = parseInt(change.from.position.split(':')[0], 10)
        const side = kind === 'Removal' ? 'before' : 'after'
        const key = `${lineNum}-${side}`
        console.log(`[Component Filter]   ${kind} - Processing from position:`, change.from.position, `-> ${side} line:`, lineNum)
        if (!lineSet.has(key)) {
          lines.push({ line: lineNum, side: side })
          lineSet.add(key)
          console.log(`[Component Filter]   ✓ Added ${side} line: ${lineNum}`)
        } else {
          console.log(`[Component Filter]   ⊗ Skipped ${side} line: ${lineNum} (already added)`)
        }
      }
      
      // Process "to" field (after side for Addition, before side for Removal)
      if (change.to && change.to.file === filePath && change.to.position) {
        const lineNum = parseInt(change.to.position.split(':')[0], 10)
        const side = kind === 'Removal' ? 'before' : 'after'
        const key = `${lineNum}-${side}`
        console.log(`[Component Filter]   ${kind} - Processing to position:`, change.to.position, `-> ${side} line:`, lineNum)
        if (!lineSet.has(key)) {
          lines.push({ line: lineNum, side: side })
          lineSet.add(key)
          console.log(`[Component Filter]   ✓ Added ${side} line: ${lineNum}`)
        } else {
          console.log(`[Component Filter]   ⊗ Skipped ${side} line: ${lineNum} (already added)`)
        }
      }
    }

    console.log('[Component Filter] Total highlighted lines:', lines)
    return lines
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
