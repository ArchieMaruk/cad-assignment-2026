import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { actorKey, ddb, movieKey, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    logRequest(event);
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



    // Only   4 Role fields are allowed in the body.
  const allowedFields = ["movieId", "actorId", "roleName", "roleDescription"];
  const extraFields = Object.keys(body).filter((key) => !allowedFields.includes(key));
  if (extraFields.length) {
    return response(400, { message: `Unexpected fields: ${extraFields.join(", ")}` });
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
              // Don't overwrite an existing role for this movie and actor.
              ConditionExpression: "attribute_not_exists(PK)",
            },
          
          },
        ],
      })
    );
    return response(201, { message: "Role added", data: role });
  }   catch (err) {
    if ((err as Error).name === "TransactionCanceledException") {
      // Reasons are in the same order as TransactItems: movie, actor, put.
      const reasons = (err as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
      if (reasons[2]?.Code === "ConditionalCheckFailed") {
        return response(409, {
          message: `Actor ${role.actorId} already has a role in movie ${role.movieId}`,
        });
      }
      return response(404, {
        message: `Movie ${role.movieId} or actor ${role.actorId} not found`,
      });
    }
    console.error("DynamoDB error:", err);
    return response(500, { message: "Internal server error" });
  }
};