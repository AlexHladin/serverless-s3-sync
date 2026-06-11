const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const mimeModule = require('mime')
const mime = mimeModule.default || mimeModule
const {
  CopyObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand
} = require('@aws-sdk/client-s3')
const { toS3Path } = require('./s3-path')

class S3SyncClient {
  static MAX_DELETE_COUNT = 1000

  constructor (s3Client) {
    this.s3Client = s3Client
  }

  uploadDir (params) {
    const ee = new EventEmitter()
    ee.progressAmount = 0
    ee.progressTotal = 0
    ;(async () => {
      try {
        const {
          localDir,
          deleteRemoved = false,
          followSymlinks = false,
          getS3Params,
          defaultContentType,
          maxAsyncS3 = 5,
          s3Params
        } = params
        const bucket = s3Params.Bucket
        const prefix = S3SyncClient.ensureSlash(s3Params.Prefix)
        const baseS3Params = { ...s3Params }
        delete baseS3Params.Prefix

        const localFiles = S3SyncClient.collectLocalFiles(
          localDir,
          followSymlinks
        )
        const s3Objects = (await this.listAllObjects(bucket, prefix))
          .map(object => ({
            key: object.Key,
            relativePath: object.Key.slice(prefix.length),
            etag: object.ETag,
            size: object.Size
          }))
          .filter(object => object.relativePath.length > 0)
          .sort((a, b) => a.relativePath.localeCompare(b.relativePath))

        const uploads = []
        const deletes = []
        let localIndex = 0
        let s3Index = 0

        while (localIndex < localFiles.length || s3Index < s3Objects.length) {
          const localFile = localFiles[localIndex]
          const s3Object = s3Objects[s3Index]

          if (
            localFile &&
            (!s3Object || localFile.relativePath < s3Object.relativePath)
          ) {
            uploads.push(localFile)
            localIndex += 1
            continue
          }

          if (
            s3Object &&
            (!localFile || s3Object.relativePath < localFile.relativePath)
          ) {
            if (deleteRemoved) {
              deletes.push(s3Object.key)
            }
            s3Index += 1
            continue
          }

          uploads.push(localFile)
          localIndex += 1
          s3Index += 1
        }

        ee.progressTotal = uploads.length + deletes.length

        await S3SyncClient.mapWithConcurrency(
          deletes,
          maxAsyncS3,
          async key => {
            await this.s3Client.send(
              new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: {
                  Objects: [{ Key: key }],
                  Quiet: true
                }
              })
            )
            ee.progressAmount += 1
            ee.emit('progress')
          }
        )

        await S3SyncClient.mapWithConcurrency(
          uploads,
          maxAsyncS3,
          async localFile => {
            const key = `${prefix}${localFile.relativePath}`
            let extraParams = { ...baseS3Params }

            if (getS3Params) {
              const customParams = await S3SyncClient.getS3ParamsAsync(
                getS3Params,
                localFile.fullPath,
                localFile.stat
              )

              if (!customParams) {
                ee.progressAmount += 1
                ee.emit('progress')
                return
              }

              extraParams = { ...extraParams, ...customParams }
            }

            const needsUpload = await this.shouldUploadFile(
              bucket,
              key,
              localFile
            )

            if (needsUpload) {
              await this.uploadLocalFile(
                localFile,
                bucket,
                key,
                extraParams,
                defaultContentType
              )
            }

            ee.progressAmount += 1
            ee.emit('progress')
          }
        )

        ee.emit('end')
      } catch (err) {
        ee.emit('error', err)
      }
    })()

    return ee
  }

  deleteDir (s3Params) {
    const ee = new EventEmitter()
    ee.progressAmount = 0
    ee.progressTotal = 0
    ;(async () => {
      try {
        const bucket = s3Params.Bucket
        const prefix = s3Params.Prefix || ''
        const keys = (await this.listAllObjects(bucket, prefix)).map(
          object => object.Key
        )

        ee.progressTotal = keys.length

        for (
          let index = 0;
          index < keys.length;
          index += S3SyncClient.MAX_DELETE_COUNT
        ) {
          const batch = keys.slice(index, index + S3SyncClient.MAX_DELETE_COUNT)
          await this.s3Client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: {
                Objects: batch.map(Key => ({ Key })),
                Quiet: true
              }
            })
          )
          ee.progressAmount += batch.length
          ee.emit('progress')
        }

        ee.emit('end')
      } catch (err) {
        ee.emit('error', err)
      }
    })()

    return ee
  }

  copyObject (s3Params) {
    const ee = new EventEmitter()

    ;(async () => {
      try {
        await this.s3Client.send(new CopyObjectCommand(s3Params))
        ee.emit('end')
      } catch (err) {
        ee.emit('error', err)
      }
    })()

    return ee
  }

  async listAllObjects (bucket, prefix) {
    const objects = []
    let continuationToken

    do {
      const response = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix || undefined,
          ContinuationToken: continuationToken
        })
      )

      if (response.Contents) {
        objects.push(...response.Contents)
      }

      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined
    } while (continuationToken)

    return objects
  }

  async shouldUploadFile (bucket, key, localFile) {
    let head

    try {
      head = await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key
        })
      )
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return true
      }

      throw err
    }

    if (head.ContentLength !== localFile.stat.size) {
      return true
    }

    if (!head.ETag || head.ETag.includes('-')) {
      return false
    }

    const md5 = await S3SyncClient.getFileMd5Hex(localFile.fullPath)
    return S3SyncClient.cleanETag(head.ETag) !== md5
  }

  async uploadLocalFile (
    localFile,
    bucket,
    key,
    extraParams,
    defaultContentType
  ) {
    const putParams = {
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(localFile.fullPath),
      ContentLength: localFile.stat.size,
      ...extraParams
    }

    if (!putParams.ContentType) {
      const detectedContentType = mime.getType(localFile.fullPath)
      if (detectedContentType) {
        putParams.ContentType = detectedContentType
      } else if (defaultContentType) {
        putParams.ContentType = defaultContentType
      }
    }

    await this.s3Client.send(new PutObjectCommand(putParams))
  }

  static ensureSlash (value) {
    if (!value) {
      return ''
    }

    return value.endsWith('/') ? value : `${value}/`
  }

  static cleanETag (etag) {
    return etag.replace(/^"|"$/g, '')
  }

  static collectLocalFiles (localDir, followSymlinks) {
    const files = []
    const resolvedLocalDir = path.resolve(localDir)

    function walk (currentDir) {
      fs.readdirSync(currentDir).forEach(entry => {
        const fullPath = path.join(currentDir, entry)
        let stat

        try {
          stat = followSymlinks ? fs.statSync(fullPath) : fs.lstatSync(fullPath)
        } catch (err) {
          return
        }

        if (stat.isDirectory()) {
          walk(fullPath)
          return
        }

        if (!stat.isFile()) {
          return
        }

        const relativePath = path.relative(resolvedLocalDir, fullPath)
        files.push({
          fullPath,
          relativePath: toS3Path(relativePath),
          stat
        })
      })
    }

    walk(resolvedLocalDir)
    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

    return files
  }

  static getS3ParamsAsync (getS3Params, localFile, stat) {
    return new Promise((resolve, reject) => {
      getS3Params(localFile, stat, (err, result) => {
        if (err) {
          reject(err)
          return
        }

        resolve(result)
      })
    })
  }

  static getFileMd5Hex (filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5')
      fs.createReadStream(filePath)
        .on('data', chunk => hash.update(chunk))
        .on('error', reject)
        .on('end', () => resolve(hash.digest('hex')))
    })
  }

  static async mapWithConcurrency (items, concurrency, fn) {
    if (items.length === 0) {
      return
    }

    let index = 0
    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      async () => {
        while (index < items.length) {
          const currentIndex = index
          index += 1
          await fn(items[currentIndex], currentIndex)
        }
      }
    )

    await Promise.all(workers)
  }
}

module.exports = S3SyncClient
