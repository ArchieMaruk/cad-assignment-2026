import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { actorKey, ddb, movieKey, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response } from "../shared/http";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const body = parseJsonObject(event);
  if (isResponse(body)) return body;

  // Check every field is present and the right type before saving.
  const isPositiveInt = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
  const isText = (v: unknown) => typeof v === "string" && v.trim() !== "";
  const invalid = [
    !isPositiveInt(body.movieId) && "movieId",
    !isPositiveInt(body.actorId) && "actorId",
    !isText(body.roleName) && "roleName",
    !isText(body.roleDescription) && "roleDescription",
  ].filter(Boolean);
  if (invalid.length) {
    return response(400, { message: `Missing or invalid fields: ${invalid.join(", ")}` });
  }

  const role: Role = {
    movieId: body.movieId as number,
    actorId: body.actorId as number,
    roleName: body.roleName as string,
    roleDescription: body.roleDescription as string,
  };

  try {
    // Add the role only if both the movie and the actor exist.
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: movieKey(role.movieId), SK: movieKey(role.movieId) },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: actorKey(role.actorId), SK: actorKey(role.actorId) },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                PK: movieKey(role.movieId),
                SK: actorKey(role.actorId),
                ...role,
              },
            },
          },
        ],
      })
    );
    return response(201, { message: "Role added", data: role });
  } catch (err) {
    // The transaction is cancelled if the movie or actor doesn't exist.
    if ((err as Error).name === "TransactionCanceledException") {
      return response(404, {
        message: `Movie ${role.movieId} or actor ${role.actorId} not found`,
      });
    }
    console.error("DynamoDB error:", err);
    return response(500, { message: "Internal server error" });
  }
};