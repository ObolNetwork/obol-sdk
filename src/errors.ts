export class ConflictError extends Error {
  name = 'ConflictError'

  constructor () {
    super('This Cluster has been already posted.')
    Object.setPrototypeOf(this, ConflictError.prototype)
  }
}
