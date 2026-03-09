import * as React from 'react'
import * as Path from 'path'
import { Button } from '../lib/button'
import { showOpenDialog } from '../main-process-proxy'

interface IFolderSelectorProps {
  readonly beforeFolder: string
  readonly afterFolder: string
  readonly diffmagicFolder: string
  readonly onDismissed: () => void
  readonly onCompareFolders: (
    beforeFolder: string,
    afterFolder: string,
    diffmagicFolder: string
  ) => void
}

interface IFolderSelectorState {
  readonly diffFolder: string
}

export class FolderSelector extends React.Component<
  IFolderSelectorProps,
  IFolderSelectorState
> {
  public constructor(props: IFolderSelectorProps) {
    super(props)
    this.state = {
      diffFolder: props.diffmagicFolder || props.beforeFolder
        ? Path.dirname(props.beforeFolder)
        : '',
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
          <h2 style={{ marginBottom: '20px', fontSize: '22px' }}>Compare Folders</h2>
          <br></br>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '14px' }}>
              Select Diff
            </label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={this.state.diffFolder}
                onChange={(e) => this.setState({ diffFolder: e.target.value })}
                placeholder="Path to diff folder (containing lhs/, rhs/, and JSON files)"
                style={{ flex: 1, padding: '8px' }}
              />
              <Button onClick={this.onSelectDiffFolder}>Browse...</Button>
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
    return this.state.diffFolder.length > 0
  }

  private onSelectDiffFolder = async () => {
    const path = await showOpenDialog({
      properties: ['openDirectory'],
    })
    if (path !== null) {
      this.setState({ diffFolder: path })
    }
  }

  private onSubmit = () => {
    if (this.canCompare()) {
      const folder = this.state.diffFolder
      this.props.onCompareFolders(
        Path.join(folder, 'lhs'),
        Path.join(folder, 'rhs'),
        folder
      )
    }
  }
}
