// @ts-nocheck - Disabled type checking for folder compare mode modifications
import * as React from 'react'

import { IAppState } from '../lib/app-state'
import { Dispatcher } from './dispatcher'
import { AppStore } from '../lib/stores'
import { sendReady } from './main-process-proxy'
import { TitleBar, ZoomInfo, FullScreenInfo } from './window'
import { FolderCompareView } from './folder-compare/folder-compare-view'
import { SettingsMenu } from './window/settings-menu'
import { AppTheme } from './app-theme'
import { ApplicationTheme } from './lib/application-theme'
import classNames from 'classnames'
import * as ipcRenderer from '../lib/ipc-renderer'

const FONT_SIZE_OFFSET_KEY = 'diffmagic-font-size-offset'

/**
 * The time to delay (in ms) from when we've loaded the initial state to showing
 * the window. This is try to give Chromium enough time to flush our latest DOM
 * changes. See https://github.com/desktop/desktop/issues/1398.
 */
const ReadyDelay = 100

interface IAppProps {
  readonly dispatcher: Dispatcher
  readonly appStore: AppStore
  readonly startTime: number
}

export const dialogTransitionTimeout = {
  enter: 250,
  exit: 100,
}

export const bannerTransitionTimeout = { enter: 500, exit: 400 }

export class App extends React.Component<IAppProps, IAppState> {
  private loading = true

  /** Font size offset from default (persisted in localStorage) */
  private fontSizeOffset: number = 0

  public constructor(props: IAppProps) {
    super(props)

    props.dispatcher.loadInitialState().then(() => {
      this.loading = false
      this.forceUpdate()

      requestIdleCallback(
        () => {
          const now = performance.now()
          sendReady(now - props.startTime)
        },
        { timeout: ReadyDelay }
      )
    })

    this.state = props.appStore.getState()
    props.appStore.onDidUpdate(state => {
      this.setState(state)
    })

    // Restore persisted font size offset
    const savedOffset = localStorage.getItem(FONT_SIZE_OFFSET_KEY)
    if (savedOffset !== null) {
      this.fontSizeOffset = parseInt(savedOffset, 10) || 0
      this.applyFontSizeOffset()
    }
  }

  public componentDidMount() {
    window.addEventListener('keydown', this.onWindowKeyDown)
  }

  public componentWillUnmount() {
    window.removeEventListener('keydown', this.onWindowKeyDown)
  }

  private onWindowKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return
    }

    // Handle Ctrl+= / Ctrl+- for font size adjustment
    if (event.ctrlKey && !event.shiftKey && !event.altKey) {
      if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        this.onFontSizeChange(1)
        return
      }
      if (event.key === '-') {
        event.preventDefault()
        this.onFontSizeChange(-1)
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        this.onFontSizeChange(-this.fontSizeOffset)
        return
      }
    }
  }

  private onFontSizeChange = (delta: number) => {
    const newOffset = Math.max(-4, Math.min(12, this.fontSizeOffset + delta))
    if (newOffset === this.fontSizeOffset) {
      return
    }
    this.fontSizeOffset = newOffset
    localStorage.setItem(FONT_SIZE_OFFSET_KEY, String(newOffset))
    this.applyFontSizeOffset()
    this.forceUpdate()
  }

  private applyFontSizeOffset() {
    const root = document.documentElement
    const base = 12
    const newSize = base + this.fontSizeOffset
    root.style.setProperty('--font-size', `${newSize}px`)
    root.style.setProperty('--font-size-sm', `${newSize - 1}px`)
    root.style.setProperty('--font-size-md', `${newSize + 2}px`)
    root.style.setProperty('--font-size-lg', `${newSize + 16}px`)
    root.style.setProperty('--font-size-xl', `${newSize + 20}px`)
    root.style.setProperty('--font-size-xxl', `${newSize + 30}px`)
    root.style.setProperty('--font-size-xs', `${Math.max(7, newSize - 3)}px`)
  }

  private onThemeToggle = () => {
    const isDark = this.state.currentTheme === ApplicationTheme.Dark
    const newTheme = isDark ? ApplicationTheme.Light : ApplicationTheme.Dark
    this.props.dispatcher.setSelectedTheme(newTheme)
  }

  private renderTitlebar() {
    const inFullScreen = this.state.windowState === 'full-screen'

    if (inFullScreen && !__WIN32__) {
      return null
    }

    const isDarkMode = this.state.currentTheme === ApplicationTheme.Dark

    return (
      <TitleBar
        showAppIcon={false}
        titleBarStyle="dark"
        windowState={this.state.windowState}
        windowZoomFactor={this.state.windowZoomFactor}
      >
        <SettingsMenu
          fontSizeOffset={this.fontSizeOffset}
          isDarkMode={isDarkMode}
          onFontSizeChange={this.onFontSizeChange}
          onThemeToggle={this.onThemeToggle}
        />
        <div className="title-bar-text">Diffmagic</div>
      </TitleBar>
    )
  }

  private renderApp() {
    return (
      <div id="desktop-app-contents">
        <FolderCompareView dispatcher={this.props.dispatcher} />
      </div>
    )
  }

  public render() {
    if (this.loading) {
      return null
    }

    const className = classNames(
      this.state.appIsFocused ? 'focused' : 'blurred',
      {
        'underline-links': this.state.underlineLinks,
      }
    )

    const currentTheme = this.state.currentTheme
    const currentTabSize = this.state.selectedTabSize

    return (
      <div
        id="desktop-app-chrome"
        className={className}
        style={{ tabSize: currentTabSize }}
      >
        <AppTheme theme={currentTheme} />
        {this.renderTitlebar()}
        {this.renderApp()}
        <ZoomInfo windowZoomFactor={this.state.windowZoomFactor} />
        <FullScreenInfo windowState={this.state.windowState} />
      </div>
    )
  }
}
