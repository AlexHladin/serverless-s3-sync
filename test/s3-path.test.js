const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { toS3Path, encodeSpecialCharacters } = require('../lib/s3-path')

describe('toS3Path', () => {
  it('converts platform separators to forward slashes', () => {
    const input = path.join('assets', 'images', 'logo.png')
    assert.equal(toS3Path(input), 'assets/images/logo.png')
  })
})

describe('encodeSpecialCharacters', () => {
  it('encodes spaces and plus signs for S3 CopySource', () => {
    const encoded = encodeSpecialCharacters('my-bucket/path with spaces+plus.txt')
    assert.ok(encoded.includes('%20'))
    assert.match(encoded, /%2[bB]plus\.txt$/)
  })

  it('leaves unreserved path segments unchanged', () => {
    assert.equal(
      encodeSpecialCharacters('bucket/folder/file.txt'),
      'bucket/folder/file.txt'
    )
  })
})
