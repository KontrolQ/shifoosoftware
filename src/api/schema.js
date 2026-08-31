export const PUBLIC_DEFINITIONS = `
  type PartialDate {
    text: String!
    year: Int
    month: Int
    day: Int
  }

  type Category {
    slug: String!
    name: String!
    summary: String
    summaryHtml: String
    titleCount: Int!
    software(query: String, limit: Int, offset: Int): [Software!]!
  }

  type Software {
    slug: String!
    name: String!
    publisher: String
    publishers(query: String, limit: Int, offset: Int): [Publisher!]!
    description: String
    descriptionHtml: String
    homepage: String
    iconUrl: String
    published: Boolean!
    releasedOn: PartialDate
    endOfLife: PartialDate
    createdAt: PartialDate
    updatedAt: PartialDate
    category: Category
    versions(query: String, limit: Int, offset: Int): [Version!]!
    versionCount: Int!
    fileCount: Int!
  }

  type Version {
    id: Int!
    slug: String!
    version: String!
    releasedOn: PartialDate
    notes: String
    notesHtml: String
    software: Software
    files(query: String, limit: Int, offset: Int): [File!]!
    fileCount: Int!
  }

  type File {
    id: Int!
    slug: String!
    displayName: String!
    fileType: String
    sizeBytes: Int
    sha256: String
    notes: String
    notesHtml: String
    published: Boolean!
    downloads: Int!
    downloadUrl: String
    version: Version
    platform: Platform
    language: Language
    platforms(query: String, limit: Int, offset: Int): [Platform!]!
    languages(query: String, limit: Int, offset: Int): [Language!]!
  }

  type Interface {
    slug: String!
    name: String!
    titleCount: Int!
  }

  type FacetOption {
    value: String!
    label: String!
    held: Int!
  }

  type FileType {
    slug: String!
    name: String!
    extension: String
    fileCount: Int!
  }

  type Publisher {
    slug: String!
    name: String!
    titleCount: Int!
    software(query: String, limit: Int, offset: Int): [Software!]!
  }

  type Platform {
    slug: String!
    name: String!
    fileCount: Int!
    files(query: String, limit: Int, offset: Int): [File!]!
  }

  type Language {
    slug: String!
    name: String!
    fileCount: Int!
    files(query: String, limit: Int, offset: Int): [File!]!
  }

  type Request {
    id: Int!
    title: String!
    publisher: String
    wantedVersion: String
    notes: String
    link: String
    askedBy: String
    happenedAt: PartialDate!
    state: String!
  }






  type PageInfo {
    total: Int!
    perPage: Int!
    currentPage: Int!
    lastPage: Int!
    hasNextPage: Boolean!
  }

  type Page {
    pageInfo: PageInfo!
    software(query: String, category: String): [Software!]!
    categories(query: String): [Category!]!
    versions(query: String): [Version!]!
    files(query: String): [File!]!
    publishers(query: String): [Publisher!]!
    platforms(query: String): [Platform!]!
    languages(query: String): [Language!]!
    interfaces(query: String): [Interface!]!
    fileTypes(query: String): [FileType!]!
    requests(state: String, query: String): [Request!]!
    facetOptions(facet: String!, query: String): [FacetOption!]!
  }

  type Query {
    Page(page: Int, perPage: Int): Page
    Software(slug: String!): Software
    Category(slug: String!): Category
    Version(id: Int!): Version
    File(id: Int!): File
    Publisher(slug: String!): Publisher
    Platform(slug: String!): Platform
    Language(slug: String!): Language
    Interface(slug: String!): Interface
    FileType(slug: String!): FileType
    Request(id: Int!): Request
  }
`;

export const ADMIN_EXTRAS = `
  type VocabularyEntry {
    slug: String!
    name: String!
    used: Int!
  }

  extend type File {
    objectKey: String
  }

  type BucketObject {
    key: String!
    sizeBytes: Int!
    uploadedAt: String!
    claimed: Boolean!
  }

  type Person {
    id: Int!
    email: String!
    displayName: String
    roleName: String
    createdAt: PartialDate
    lastSeenAt: PartialDate
  }

  type Role {
    id: Int!
    name: String!
    permissions: String!
    everything: Boolean!
    peopleCount: Int!
  }

  type Change {
    id: Int!
    happenedAt: PartialDate!
    who: String
    subject: String!
    deed: String!
    detail: String
  }

  type Viewer {
    email: String!
    name: String
    roleName: String
    permissions: String!
  }

  type HotlinkChoice {
    slug: String!
    name: String!
    targetUrl: String!
    host: String!
    sizeBytes: Int
    useCount: Int!
  }

  type VersionChoice {
    path: String!
    version: String!
    softwareName: String!
    softwareSlug: String!
    fileCount: Int!
  }

  extend type Query {
    Viewer: Viewer
    Hotlink(slug: String!): HotlinkChoice
  }

  extend type Page {
    people(query: String): [Person!]!
    roles(query: String): [Role!]!
    changes(query: String): [Change!]!
    bucketObjects(query: String, prefix: String): [BucketObject!]!
    hotlinks(query: String): [HotlinkChoice!]!
    versionChoices(query: String): [VersionChoice!]!
    vocabulary(kind: String!, query: String): [VocabularyEntry!]!
  }
`;
