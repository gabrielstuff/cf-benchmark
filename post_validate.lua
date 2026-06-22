-- wrk lua script for POST /validate with JSON body
wrk.method = "POST"
wrk.body   = '{"name":"Alice","age":30}'
wrk.headers["Content-Type"] = "application/json"
