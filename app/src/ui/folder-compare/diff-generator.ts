import * as Path from 'path'
import * as FSPromises from 'fs/promises'
import { ITextDiff, DiffType } from '../../models/diff'
import { WorkingDirectoryFileChange } from '../../models/status'
import { AppFileStatusKind } from '../../models/status'
import { DiffParser } from '../../lib/diff-parser'
import { git } from '../../lib/git'

/**
 * Compute a diff between two versions of a file in different folders
 * Uses git diff --no-index to generate proper unified diffs
 */
export async function computeDiff(
  beforeFolderPath: string,
  afterFolderPath: string,
  file: WorkingDirectoryFileChange
): Promise<ITextDiff | null> {
  const beforeFilePath = Path.join(beforeFolderPath, file.path)
  const afterFilePath = Path.join(afterFolderPath, file.path)
  
  try {
    let diffOutput: string
    
    if (file.status.kind === AppFileStatusKind.New) {
      // For new files, check if file exists first
      const afterExists = await FSPromises.access(afterFilePath).then(() => true).catch(() => false)
      if (!afterExists) {
        console.error('After file does not exist:', afterFilePath)
        return null
      }
      
      // Use NUL on Windows, /dev/null on Unix
      const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
      const result = await git(
        ['diff', '--no-index', '--no-color', '--', nullDevice, afterFilePath],
        beforeFolderPath,
        'computeDiff',
        { successExitCodes: new Set([0, 1]) }
      )
      diffOutput = result.stdout
    } else if (file.status.kind === AppFileStatusKind.Deleted) {
      // For deleted files
      const beforeExists = await FSPromises.access(beforeFilePath).then(() => true).catch(() => false)
      if (!beforeExists) {
        console.error('Before file does not exist:', beforeFilePath)
        return null
      }
      
      const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
      const result = await git(
        ['diff', '--no-index', '--no-color', '--', beforeFilePath, nullDevice],
        beforeFolderPath,
        'computeDiff',
        { successExitCodes: new Set([0, 1]) }
      )
      diffOutput = result.stdout
    } else {
      // For modified files, diff the two versions
      const beforeExists = await FSPromises.access(beforeFilePath).then(() => true).catch(() => false)
      const afterExists = await FSPromises.access(afterFilePath).then(() => true).catch(() => false)
      
      if (!beforeExists || !afterExists) {
        console.error('File does not exist:', !beforeExists ? beforeFilePath : afterFilePath)
        return null
      }
      
      const result = await git(
        ['diff', '--no-index', '--no-color', '--', beforeFilePath, afterFilePath],
        beforeFolderPath,
        'computeDiff',
        { successExitCodes: new Set([0, 1]) }
      )
      diffOutput = result.stdout
    }
    
    console.log('Git diff output for', file.path, ':', diffOutput.substring(0, 500))
    
    // Parse the git diff output using GitHub Desktop's parser
    const parser = new DiffParser()
    const rawDiff = parser.parse(diffOutput)
    
    console.log('Parsed diff hunks:', rawDiff.hunks.length, 'binary:', rawDiff.isBinary)
    
    // Read the after content for the text property
    let text = ''
    if (file.status.kind !== AppFileStatusKind.Deleted) {
      text = await FSPromises.readFile(afterFilePath, 'utf-8').catch(() => '')
    }
    
    // Convert to ITextDiff format
    const textDiff: ITextDiff = {
      kind: DiffType.Text,
      text: text,
      hunks: rawDiff.hunks,
      maxLineNumber: rawDiff.maxLineNumber,
      hasHiddenBidiChars: rawDiff.hasHiddenBidiChars,
    }
    
    return textDiff
  } catch (error) {
    console.error('Error computing diff:', error)
    return null
  }
}
