import { httpRouter } from 'convex/server'
import { auth } from './auth'

const http = httpRouter()

// Маршруты авторизации Convex Auth (обмен токенов и т.п.)
auth.addHttpRoutes(http)

export default http
