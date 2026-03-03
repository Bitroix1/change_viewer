import * as React from 'react'

interface IKeyboardShortcutProps {
  readonly darwinKeys?: ReadonlyArray<string>
  readonly keys?: ReadonlyArray<string>
}

export class KeyboardShortcut extends React.Component<IKeyboardShortcutProps> {
  public render() {
    const keys = __DARWIN__ ? this.props.darwinKeys : this.props.keys
    if (!keys || keys.length === 0) {
      return null
    }
    return <span>{keys.join('')}</span>
  }
}
