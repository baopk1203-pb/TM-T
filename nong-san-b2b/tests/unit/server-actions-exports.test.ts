import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import fs from 'fs'
import path from 'path'

interface InvalidExport {
  name: string
  kind: string
  line: number
}

interface FileAnalysis {
  filePath: string
  invalidExports: InvalidExport[]
}

function analyzeUseServerFile(filePath: string): FileAnalysis | null {
  const code = fs.readFileSync(filePath, 'utf8')
  const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true)

  // Kiểm tra chỉ thị 'use server' ở cấp file (statement đầu tiên hoặc top-level string literal)
  let hasUseServer = false
  for (const stmt of sf.statements) {
    if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)) {
      if (stmt.expression.text === 'use server') {
        hasUseServer = true
        break
      }
    }
  }

  if (!hasUseServer) return null

  const invalidExports: InvalidExport[] = []

  for (const stmt of sf.statements) {
    // 1. Typescript types và interfaces bị loại bỏ lúc compile -> HỢP LỆ (không tạo runtime export)
    if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) {
      continue
    }

    // 2. Kiểm tra các câu lệnh có keyword `export`
    const modifiers = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined
    const isExported = modifiers ? modifiers.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.ExportKeyword) : false

    if (isExported) {
      if (ts.isFunctionDeclaration(stmt)) {
        // Trong file 'use server', function export BẮT BUỘC phải là async function
        const funcModifiers = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined
        const isAsync = funcModifiers ? funcModifiers.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.AsyncKeyword) : false
        if (!isAsync) {
          invalidExports.push({
            name: stmt.name ? stmt.name.text : 'anonymous',
            kind: 'non-async-function',
            line: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
          })
        }
      } else if (ts.isVariableStatement(stmt)) {
        // Mọi biến/đối tượng export (const/let/var, kể cả Zod schema, object, array, primitive) đều BỊ CẤM
        for (const decl of stmt.declarationList.declarations) {
          invalidExports.push({
            name: decl.name.getText(sf),
            kind: 'variable/object/constant',
            line: sf.getLineAndCharacterOfPosition(decl.getStart()).line + 1,
          })
        }
      } else if (ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
        invalidExports.push({
          name: stmt.name ? stmt.name.text : 'anonymous',
          kind: ts.isClassDeclaration(stmt) ? 'class' : 'enum',
          line: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
        })
      }
    } else if (ts.isExportDeclaration(stmt)) {
      // 3. Named re-exports: export { a, b as c }
      if (stmt.isTypeOnly) {
        continue // export type { ... } là type-only -> HỢP LỆ
      }
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const element of stmt.exportClause.elements) {
          if (!element.isTypeOnly) {
            invalidExports.push({
              name: element.name.text,
              kind: 'named-export',
              line: sf.getLineAndCharacterOfPosition(element.getStart()).line + 1,
            })
          }
        }
      } else if (!stmt.exportClause) {
        // export * from '...'
        invalidExports.push({
          name: stmt.getText(sf),
          kind: 'export-all-wildcard',
          line: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
        })
      }
    } else if (ts.isExportAssignment(stmt)) {
      // 4. Default export
      invalidExports.push({
        name: 'default',
        kind: 'export-default',
        line: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
      })
    }
  }

  return {
    filePath,
    invalidExports,
  }
}

function findSourceFiles(dir: string): string[] {
  const results: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.next' && entry.name !== '.git') {
        results.push(...findSourceFiles(fullPath))
      }
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      results.push(fullPath)
    }
  }
  return results
}

describe('Server Actions Export Guard (Next.js "use server" Specification)', () => {
  const srcRoot = path.resolve(__dirname, '../../src')
  const allSourceFiles = findSourceFiles(srcRoot)

  it('xác định đúng các file có chỉ thị "use server" ở cấp file', () => {
    const useServerFiles = allSourceFiles
      .map(analyzeUseServerFile)
      .filter((res): res is FileAnalysis => res !== null)

    expect(useServerFiles.length).toBeGreaterThan(0)
    // Xác nhận các module Server Action cốt lõi được nhận diện
    const fileNames = useServerFiles.map((f) => path.basename(f.filePath))
    expect(fileNames).toContain('shipping-admin.ts')
    expect(fileNames).toContain('order.ts')
    expect(fileNames).toContain('order-lifecycle.ts')
    expect(fileNames).toContain('cart.ts')
  })

  it('tất cả các module "use server" chỉ được export async functions, tuyệt đối không export objects/constants', () => {
    const useServerFiles = allSourceFiles
      .map(analyzeUseServerFile)
      .filter((res): res is FileAnalysis => res !== null)

    const allViolations: Array<{ file: string; exports: InvalidExport[] }> = []

    for (const file of useServerFiles) {
      if (file.invalidExports.length > 0) {
        allViolations.push({
          file: path.relative(srcRoot, file.filePath),
          exports: file.invalidExports,
        })
      }
    }

    if (allViolations.length > 0) {
      const formatted = allViolations
        .map(
          (v) =>
            `File: ${v.file}\n` +
            v.exports.map((e) => `  - Dòng ${e.line}: [${e.kind}] ${e.name}`).join('\n')
        )
        .join('\n\n')

      expect.fail(
        `Phát hiện ${allViolations.length} file "use server" vi phạm quy định export của Next.js:\n\n${formatted}\n\nQuy chuẩn: File có chỉ thị "use server" chỉ được export async function. Mọi constant/schema/object phải chuyển thành internal const hoặc chuyển sang module không có "use server".`
      )
    }

    expect(allViolations).toHaveLength(0)
  })
})
