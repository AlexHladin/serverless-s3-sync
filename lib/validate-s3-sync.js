const Ajv = require('ajv')

const bucketSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    bucketName: { type: 'string', minLength: 1 },
    bucketNameKey: { type: 'string', minLength: 1 },
    localDir: { type: 'string', minLength: 1 },
    bucketPrefix: { type: 'string' },
    deleteRemoved: { type: 'boolean' },
    acl: { type: 'string', minLength: 1 },
    followSymlinks: { type: 'boolean' },
    defaultContentType: { type: 'string', minLength: 1 },
    enabled: { type: 'boolean' },
    preCommand: { type: 'string', minLength: 1 },
    params: {
      type: 'array',
      items: {
        type: 'object',
        minProperties: 1,
        additionalProperties: {
          type: 'object',
          additionalProperties: true
        }
      }
    },
    bucketTags: {
      type: 'object',
      additionalProperties: { type: 'string' }
    }
  },
  anyOf: [{ required: ['bucketName'] }, { required: ['bucketNameKey'] }]
}

const s3SyncSchema = {
  oneOf: [
    {
      type: 'array',
      items: bucketSchema
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        endpoint: { type: 'string', minLength: 1 },
        noSync: {
          anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['TRUE', 'FALSE'] }]
        },
        hooks: {
          type: 'array',
          items: { type: 'string', minLength: 1 }
        },
        buckets: {
          type: 'array',
          items: bucketSchema
        }
      }
    }
  ]
}

const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(s3SyncSchema)

function formatValidationErrors (errors) {
  return errors
    .map((error) => {
      const path = error.instancePath || 'custom.s3Sync'
      return `${path} ${error.message}`.trim()
    })
    .join('; ')
}

function validateS3Sync (config) {
  if (!validate(config)) {
    throw new Error(
      `Invalid custom.s3Sync configuration: ${formatValidationErrors(validate.errors)}`
    )
  }
}

module.exports = {
  bucketSchema,
  formatValidationErrors,
  s3SyncSchema,
  validateS3Sync
}
