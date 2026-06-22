FROM alpine:3.20

RUN apk add --no-cache wrk nodejs

WORKDIR /app
COPY src/load-tester.js .

EXPOSE 8080
CMD ["node", "load-tester.js"]
