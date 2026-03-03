import * as React from 'react'

interface ISettingsMenuProps {
  readonly fontSizeOffset: number
  readonly isDarkMode: boolean
  readonly onFontSizeChange: (delta: number) => void
  readonly onThemeToggle: () => void
}

interface ISettingsMenuState {
  readonly isOpen: boolean
}

export class SettingsMenu extends React.Component<
  ISettingsMenuProps,
  ISettingsMenuState
> {
  private menuRef = React.createRef<HTMLDivElement>()

  public constructor(props: ISettingsMenuProps) {
    super(props)
    this.state = { isOpen: false }
  }

  public componentDidMount() {
    document.addEventListener('mousedown', this.onDocumentMouseDown)
  }

  public componentWillUnmount() {
    document.removeEventListener('mousedown', this.onDocumentMouseDown)
  }

  private onDocumentMouseDown = (e: MouseEvent) => {
    if (
      this.state.isOpen &&
      this.menuRef.current &&
      !this.menuRef.current.contains(e.target as Node)
    ) {
      this.setState({ isOpen: false })
    }
  }

  private onToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    this.setState(prev => ({ isOpen: !prev.isOpen }))
  }

  private onIncreaseFontSize = (e: React.MouseEvent) => {
    e.stopPropagation()
    this.props.onFontSizeChange(1)
  }

  private onDecreaseFontSize = (e: React.MouseEvent) => {
    e.stopPropagation()
    this.props.onFontSizeChange(-1)
  }

  private onResetFontSize = (e: React.MouseEvent) => {
    e.stopPropagation()
    this.props.onFontSizeChange(-this.props.fontSizeOffset)
  }

  private onThemeToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    this.props.onThemeToggle()
  }

  public render() {
    return (
      <div className="settings-menu" ref={this.menuRef}>
        <button
          className="settings-menu-button"
          onClick={this.onToggle}
          aria-expanded={this.state.isOpen}
          aria-label="Settings"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" />
            <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" />
          </svg>
          <span className="settings-menu-label">Settings</span>
          <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" style={{ marginLeft: 2 }}>
            <path d="M5 7L1 3h8z" />
          </svg>
        </button>
        {this.state.isOpen && this.renderDropdown()}
      </div>
    )
  }

  private renderDropdown() {
    const { fontSizeOffset, isDarkMode } = this.props
    const currentSize = 12 + fontSizeOffset

    return (
      <div className="settings-menu-dropdown">
        <div className="settings-menu-section">
          <div className="settings-menu-section-header">Font Size</div>
          <div className="settings-menu-font-controls">
            <button
              className="settings-menu-font-btn"
              onClick={this.onDecreaseFontSize}
              title="Decrease font size (Ctrl+-)"
              disabled={fontSizeOffset <= -4}
            >
              −
            </button>
            <span className="settings-menu-font-value">{currentSize}px</span>
            <button
              className="settings-menu-font-btn"
              onClick={this.onIncreaseFontSize}
              title="Increase font size (Ctrl++)"
              disabled={fontSizeOffset >= 12}
            >
              +
            </button>
            {fontSizeOffset !== 0 && (
              <button
                className="settings-menu-font-reset"
                onClick={this.onResetFontSize}
                title="Reset to default"
              >
                Reset
              </button>
            )}
          </div>
          <div className="settings-menu-font-shortcut">Ctrl + / Ctrl −</div>
        </div>
        <div className="settings-menu-divider" />
        <div className="settings-menu-section">
          <div className="settings-menu-section-header">Color Scheme</div>
          <div className="settings-menu-theme-toggle">
            <button
              className={`settings-menu-theme-btn ${!isDarkMode ? 'active' : ''}`}
              onClick={!isDarkMode ? undefined : this.onThemeToggle}
            >
              Light
            </button>
            <button
              className={`settings-menu-theme-btn ${isDarkMode ? 'active' : ''}`}
              onClick={isDarkMode ? undefined : this.onThemeToggle}
            >
              Dark
            </button>
          </div>
        </div>
      </div>
    )
  }
}
