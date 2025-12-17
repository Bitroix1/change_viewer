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
  readonly selectedFile: WorkingDirectoryFileChange | null
  readonly currentDiff: ITextDiff | null
  readonly isLoading: boolean
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
      selectedFile: null,
      currentDiff: null,
      isLoading: false,
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
        
        {this.state.isLoading && <div style={{ padding: '20px' }}>Loading...</div>}
        
        {!this.state.isLoading && this.state.fileChanges.length === 0 && (
          <div style={{ padding: '20px' }}>No differences found</div>
        )}
        
        {!this.state.isLoading && this.state.fileChanges.length > 0 && (
          <div className="folder-compare-content" style={{ 
            display: 'flex', 
            flex: 1, 
            overflow: 'hidden',
            minHeight: 0  // Important for flex children
          }}>
            <div className="file-list" style={{ 
              width: '300px', 
              borderRight: '1px solid var(--box-border-color)', 
              overflowY: 'auto',
              padding: '10px',
              flexShrink: 0
            }}>
              <h3 style={{ margin: '0 0 10px 0' }}>Changed Files ({this.state.fileChanges.length})</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {this.state.fileChanges.map(file => (
                  <li
                    key={file.id}
                    onClick={() => this.onFileSelected(file)}
                    style={{
                      padding: '8px',
                      cursor: 'pointer',
                      backgroundColor: this.state.selectedFile?.id === file.id ? 'var(--background-color)' : 'transparent',
                      borderRadius: '4px',
                      marginBottom: '4px'
                    }}
                  >
                    <div style={{ fontWeight: this.state.selectedFile?.id === file.id ? 'bold' : 'normal' }}>
                      {file.path}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary-color)' }}>
                      {this.getStatusLabel(file.status.kind)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            
            {this.state.selectedFile && (
              <div className="diff-view" style={{ 
                flex: 1, 
                display: 'flex', 
                flexDirection: 'column',
                minHeight: 0,
                minWidth: 0,
                overflow: 'hidden'
              }}>
                {!this.state.currentDiff ? (
                  <div style={{ padding: '20px', textAlign: 'center' }}>
                    Loading diff for {this.state.selectedFile.path}...
                  </div>
                ) : (
                  <>
                    <div style={{ 
                      padding: '10px', 
                      borderBottom: '1px solid var(--box-border-color)',
                      flexShrink: 0
                    }}>
                      <h3 style={{ margin: 0 }}>{this.state.selectedFile.path}</h3>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary-color)' }}>
                        {this.getStatusLabel(this.state.selectedFile.status.kind)}
                      </div>
                    </div>
                    <div className="diff-container" style={{ 
                      flex: 1, 
                      overflow: 'auto',
                      minHeight: 0,
                      position: 'relative'
                    }}>
                      <Diff
                        repository={this.getDummyRepository()}
                        readOnly={true}
                        file={this.state.selectedFile}
                        diff={this.state.currentDiff}
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
                  </>
                )}
              </div>
            )}
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
      })
    } catch (error) {
      console.error('Error comparing folders:', error)
      this.setState({ isLoading: false })
    }
  }

  private onChangeFolders = () => {
    this.setState({
      showFolderSelector: true,
      fileChanges: [],
      selectedFile: null,
      currentDiff: null,
    })
  }

  private onFileSelected = async (file: WorkingDirectoryFileChange) => {
    console.log('File selected:', file.path)
    this.setState({ selectedFile: file, currentDiff: null })
    
    // Generate diff for the selected file
    try {
      const diff = await computeDiff(
        this.state.beforeFolder,
        this.state.afterFolder,
        file
      )
      console.log('Diff generated:', diff)
      if (diff) {
        this.setState({ currentDiff: diff })
      } else {
        console.error('Diff is null for file:', file.path)
      }
    } catch (error) {
      console.error('Error generating diff:', error)
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
