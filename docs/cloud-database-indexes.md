# Cloud Database Indexes

Create these indexes in the WeChat Cloud Development console before deploying
the updated cloud functions. The first three are the baseline indexes; the
additional filtered-list indexes are required by `topicData.list` and
`topicData.related` when those filters are used together with `sortOrder`.

| Collection | Index fields |
| --- | --- |
| `communication_topics` | `ageGroup: 1, status: 1, sortOrder: 1` |
| `communication_topics` | `ageGroup: 1, status: 1, contentType: 1, sortOrder: 1` |
| `communication_topics` | `status: 1, isFree: 1` |
| `communication_topics` | `ageGroup: 1, status: 1, contentType: 1, momentKey: 1, sortOrder: 1` |
| `communication_topics` | `ageGroup: 1, status: 1, contentType: 1, level1: 1, sortOrder: 1` |
| `communication_packages` | `status: 1, sortOrder: 1` |
| `communication_chapters` | `packageId: 1, status: 1, chapterIndex: 1` |
| `communication_user_profiles` | document ID `openid` (automatic) |
| `communication_membership_orders` | `openid: 1, status: 1` |

After creating the indexes, deploy `topicData`, `packageData`, `topicVisit`,
and `importData`, then import `communication_topics.json` once so the
materialized `isFree` flags are written to the database.
