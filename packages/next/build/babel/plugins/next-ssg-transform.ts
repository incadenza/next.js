import { PluginObj } from '@babel/core'
import * as BabelTypes from '@babel/types'

const pageComponentVar = '__NEXT_COMP'
const prerenderId = '__NEXT_SPR'

export const EXPORT_NAME_GET_STATIC_PROPS = 'unstable_getStaticProps'
export const EXPORT_NAME_GET_STATIC_PATHS = 'unstable_getStaticPaths'

export default function nextTransformSsg({
  types: t,
}: {
  types: typeof BabelTypes
}): PluginObj<{
  isPrerender: boolean
  done: boolean
}> {
  return {
    visitor: {
      Program: {
        enter(path, state) {
          path.traverse({
            // export function unstable_getStaticPaths() {}
            ExportNamedDeclaration(path) {
              const declaration = path.node.declaration
              if (!declaration) {
                return
              }

              if (declaration.type === 'VariableDeclaration') {
                return
              }

              const name =
                declaration.type === 'FunctionDeclaration'
                  ? declaration.id && declaration.id.name
                  : null

              if (name == null) {
                throw new Error(`invariant: null function declaration`)
              }

              if (
                name === EXPORT_NAME_GET_STATIC_PROPS ||
                name === EXPORT_NAME_GET_STATIC_PATHS
              ) {
                path.remove()
                state.isPrerender = true
              }
            },
            // export { unstable_getStaticPaths } from '.'
            ExportSpecifier(path) {
              const name = path.node.exported.name
              if (
                name === EXPORT_NAME_GET_STATIC_PROPS ||
                name === EXPORT_NAME_GET_STATIC_PATHS
              ) {
                state.isPrerender = true

                const parent = path.parent

                if (parent.type !== 'ExportNamedDeclaration') {
                  throw new Error(
                    `invariant: ${path.type} has unknown parent: ${parent.type}`
                  )
                }

                if (!parent.source) {
                  const localName = path.node.local.name

                  const binding = path.scope.getBinding(localName)
                  if (binding) {
                    binding.path.remove()
                  }
                }

                path.remove()
                if (parent.specifiers.length === 0) {
                  path.parentPath.remove()
                }
              }
            },
            // export const unstable_getStaticPaths = () => {}
            VariableDeclaration(path) {
              if (path.parent.type !== 'ExportNamedDeclaration') {
                return
              }

              path.node.declarations = path.node.declarations.filter(d => {
                const name = d.id.type === 'Identifier' && d.id.name

                const isPrerender =
                  name === EXPORT_NAME_GET_STATIC_PROPS ||
                  name === EXPORT_NAME_GET_STATIC_PATHS

                if (isPrerender) {
                  state.isPrerender = true
                }

                return !isPrerender
              })

              if (path.node.declarations.length === 0) {
                path.parentPath.remove()
              }
            },
          })
        },
        exit(path, state) {
          if (state.isPrerender) {
            ;(path.scope as any).crawl()
          }

          path.traverse({
            ExportDefaultDeclaration(path) {
              if (!state.isPrerender || state.done) {
                return
              }

              state.done = true

              const prev = path.node.declaration
              if (prev.type.endsWith('Declaration')) {
                prev.type = prev.type.replace(
                  /Declaration$/,
                  'Expression'
                ) as any
              }

              // @ts-ignore invalid return type
              const [pageCompPath] = path.replaceWithMultiple([
                t.variableDeclaration('const', [
                  t.variableDeclarator(
                    t.identifier(pageComponentVar),
                    prev as any
                  ),
                ]),
                t.assignmentExpression(
                  '=',
                  t.memberExpression(
                    t.identifier(pageComponentVar),
                    t.identifier(prerenderId)
                  ),
                  t.booleanLiteral(true)
                ),
                t.exportDefaultDeclaration(t.identifier(pageComponentVar)),
              ])
              path.scope.registerDeclaration(pageCompPath)
            },
          })
        },
      },
    },
  }
}
