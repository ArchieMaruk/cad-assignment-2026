import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  actorKey,
  ddb,
  isRoleItem,
  movieKey,
  parseId,
  tableName,
  toRole,
} from "../shared/db";
import { response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const movieId = parseId(event.pathParameters?.movieID);
  if (movieId === undefined) {
    return response(400, { message: "movieID must be a positive integer" });
  }

   // Optional ?actor= filter:
  // 1. Read the optional actor value from the query string.
  // 2. Check it's a positive integer, otherwise return a 400 error.
  // 3. If given, return only that actor's role in this movie.
  const actorParam = event.queryStringParameters?.actor;
  const actorId = parseId(actorParam);
  if (actorParam !== undefined && actorId === undefined) {
    return response(400, { message: "actor must be a positive integer" });
  }

  try {
    // With an actor query parameter, get the role for this movie and actor
    if (actorId !== undefined) {
      const roleResult = await ddb.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: movieKey(movieId), SK: actorKey(actorId) },
        })
      );
            if (!roleResult.Item) {
        return response(404, { message: `Actor ${actorId} has no role in movie ${movieId}` });
      }
      return response(200, { data: [toRole(roleResult.Item)] });
    }

    // if there is no actor query parameter, get all the roles for this movie
    const queryResult = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": movieKey(movieId) },
      })
    );

        const roles = (queryResult.Items ?? []).filter(isRoleItem).map(toRole);
    if (roles.length === 0) {
      return response(404, { message: `No roles found for movie ${movieId}` });
    }
    return response(200, { data: roles });
    
  } catch (err) {
    console.error("DynamoDB error:", err);
    return response(500, { message: "Internal server error" });
  }
};