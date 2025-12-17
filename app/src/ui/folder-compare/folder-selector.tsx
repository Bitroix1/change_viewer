import * as React from 'react'
import { Button } from '../lib/button'
import { showOpenDialog } from '../main-process-proxy'

interface IFolderSelectorProps {
  readonly beforeFolder: string
  readonly afterFolder: string
  readonly onDismissed: () => void
  readonly onCompareFolders: (beforeFolder: string, afterFolder: string) => void
}

interface IFolderSelectorState {
  readonly beforeFolder: string
  readonly afterFolder: string
}

export class FolderSelector extends React.Component<
  IFolderSelectorProps,
  IFolderSelectorState
> {
  public constructor(props: IFolderSelectorProps) {
    super(props)
    this.state = {
      beforeFolder: props.beforeFolder,
      afterFolder: props.afterFolder,
    }
  }

  public render() {
    return (
      <div className="folder-selector-container" style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '20px'
      }}>
        <div style={{
          maxWidth: '600px',
          width: '100%',
          backgroundColor: 'var(--box-background-color)',
          padding: '30px',
          borderRadius: '8px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ marginBottom: '20px' }}>Compare Folders</h2>
          
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
              Before Folder
            </label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={this.state.beforeFolder}
                onChange={(e) => this.onBeforeFolderChanged(e.target.value)}
                placeholder="Enter path to 'before' folder"
                style={{ flex: 1, padding: '8px' }}
              />
              <Button onClick={this.onSelectBeforeFolder}>Browse...</Button>
            </div>
          </div>
          
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
              After Folder
            </label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={this.state.afterFolder}
                onChange={(e) => this.onAfterFolderChanged(e.target.value)}
                placeholder="Enter path to 'after' folder"
                style={{ flex: 1, padding: '8px' }}
              />
              <Button onClick={this.onSelectAfterFolder}>Browse...</Button>
            </div>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={this.onSubmit} disabled={!this.canCompare()}>
              Compare
            </Button>
          </div>
        </div>
      </div>
    )
  }

  private canCompare = () => {
    return this.state.beforeFolder.length > 0 && this.state.afterFolder.length > 0
  }

  private onBeforeFolderChanged = (value: string) => {
    this.setState({ beforeFolder: value })
  }

  private onAfterFolderChanged = (value: string) => {
    this.setState({ afterFolder: value })
  }

  private onSelectBeforeFolder = async () => {
    const path = await showOpenDialog({
      properties: ['openDirectory'],
    })
    if (path !== null) {
      this.setState({ beforeFolder: path })
    }
  }

  private onSelectAfterFolder = async () => {
    const path = await showOpenDialog({
      properties: ['openDirectory'],
    })
    if (path !== null) {
      this.setState({ afterFolder: path })
    }
  }

  private onSubmit = () => {
    if (this.canCompare()) {
      this.props.onCompareFolders(this.state.beforeFolder, this.state.afterFolder)
    }
  }
}
