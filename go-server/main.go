// Gin benchmark server.
//
// Endpoints:
//   GET  /plaintext   -> "Hello, World!"
//   GET  /json        -> {"message": "Hello, World!"}
//   GET  /user/:id    -> {"id": <id>, "name": "User <id>"}
//   POST /validate    -> echo validated body {"name": str, "age": int}

package main

import (
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strconv"

	"github.com/gin-gonic/gin"
)

const hello = "Hello, World!"

type ValidateInput struct {
	Name string `json:"name" binding:"required,min=1"`
	Age  int    `json:"age" binding:"required,gte=0,lte=150"`
}

func main() {
	workers := 4
	if v, err := strconv.Atoi(os.Getenv("WORKERS")); err == nil && v > 0 {
		workers = v
	}
	runtime.GOMAXPROCS(workers)

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()

	r.GET("/plaintext", func(c *gin.Context) {
		c.String(http.StatusOK, hello)
	})

	r.GET("/json", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": hello})
	})

	r.GET("/user/:id", func(c *gin.Context) {
		id := c.Param("id")
		c.JSON(http.StatusOK, gin.H{
			"id":   id,
			"name": fmt.Sprintf("User %s", id),
		})
	})

	r.POST("/validate", func(c *gin.Context) {
		var input ValidateInput
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"name":  input.Name,
			"age":   input.Age,
			"valid": true,
		})
	})

	fmt.Println("Gin listening on http://localhost:3000")
	r.Run(":3000")
}
