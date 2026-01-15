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
    //const lineCount = diff.hunks.reduce((total, hunk) => total + hunk.lines.length, 0)
    //const hunkCount = diff.hunks.length
    //const totalRows = lineCount + hunkCount  // Each hunk header is also a row
    const calculatedHeight = 75 + (7 * 20)
    
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
