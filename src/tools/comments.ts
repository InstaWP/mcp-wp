// src/tools/comments.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressRequest } from '../wordpress.js';
import { WPComment } from '../types/wordpress-types.js';
import { z } from 'zod';

// Schema for listing comments
const listCommentsSchema = z.object({
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  page: z.coerce.number().optional().describe("Page number (default 1)"),
  per_page: z.coerce.number().min(1).max(100).optional().describe("Items per page (default 10, max 100)"),
  search: z.string().optional().describe("Search term for comment content"),
  after: z.string().optional().describe("ISO8601 date string to get comments published after this date"),
  author: z.union([z.coerce.number(), z.array(z.coerce.number())]).optional().describe("Author ID or array of IDs"),
  author_email: z.string().email().optional().describe("Author email address"),
  author_exclude: z.array(z.coerce.number()).optional().describe("Array of author IDs to exclude"),
  post: z.coerce.number().optional().describe("Post ID to retrieve comments for"),
  status: z.enum(['approve', 'hold', 'spam', 'trash']).optional().describe("Comment status"),
  type: z.string().optional().describe("Comment type"),
  orderby: z.enum(['date', 'date_gmt', 'id', 'include', 'post', 'parent', 'type']).optional().describe("Sort comments by parameter"),
  order: z.enum(['asc', 'desc']).optional().describe("Order sort attribute ascending or descending")
});

// Schema for getting a single comment
const getCommentSchema = z.object({
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  id: z.coerce.number().describe("Comment ID")
}).strict();

// Schema for creating a comment
const createCommentSchema = z.object({
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  post: z.coerce.number().describe("The ID of the post object the comment is for"),
  author: z.coerce.number().optional().describe("The ID of the user object, if the author is a registered user"),
  author_name: z.string().optional().describe("Display name for the comment author"),
  author_email: z.string().email().optional().describe("Email address for the comment author"),
  author_url: z.string().url().optional().describe("URL for the comment author"),
  content: z.string().describe("The content of the comment"),
  parent: z.coerce.number().optional().describe("The ID of the parent comment"),
  status: z.enum(['approve', 'hold']).optional().describe("State of the comment")
}).strict();

// Schema for updating a comment
const updateCommentSchema = z.object({
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  id: z.coerce.number().describe("Comment ID"),
  post: z.coerce.number().optional().describe("The ID of the post object the comment is for"),
  author: z.coerce.number().optional().describe("The ID of the user object, if the author is a registered user"),
  author_name: z.string().optional().describe("Display name for the comment author"),
  author_email: z.string().email().optional().describe("Email address for the comment author"),
  author_url: z.string().url().optional().describe("URL for the comment author"),
  content: z.string().optional().describe("The content of the comment"),
  parent: z.coerce.number().optional().describe("The ID of the parent comment"),
  status: z.enum(['approve', 'hold', 'spam', 'trash']).optional().describe("State of the comment")
}).strict();

// Schema for deleting a comment
const deleteCommentSchema = z.object({
  site_id: z.string().optional().describe("Site ID (for multi-site setups)"),
  id: z.coerce.number().describe("Comment ID"),
  force: z.boolean().optional().describe("Whether to bypass trash and force deletion")
}).strict();

// TypeScript types for the parameters
type ListCommentsParams = z.infer<typeof listCommentsSchema>;
type GetCommentParams = z.infer<typeof getCommentSchema>;
type CreateCommentParams = z.infer<typeof createCommentSchema>;
type UpdateCommentParams = z.infer<typeof updateCommentSchema>;
type DeleteCommentParams = z.infer<typeof deleteCommentSchema>;

// Define the tools
export const commentTools: Tool[] = [
  {
    name: "list_comments",
    description: "Lists comments with filtering, sorting, and pagination options",
    inputSchema: { type: "object", properties: listCommentsSchema.shape }
  },
  {
    name: "get_comment",
    description: "Gets a comment by ID",
    inputSchema: { type: "object", properties: getCommentSchema.shape }
  },
  {
    name: "create_comment",
    description: "Creates a new comment",
    inputSchema: { type: "object", properties: createCommentSchema.shape }
  },
  {
    name: "update_comment",
    description: "Updates an existing comment",
    inputSchema: { type: "object", properties: updateCommentSchema.shape }
  },
  {
    name: "delete_comment",
    description: "Deletes a comment",
    inputSchema: { type: "object", properties: deleteCommentSchema.shape }
  }
];

// Implement the handlers
export const commentHandlers = {
  list_comments: async (params: ListCommentsParams) => {
    try {
      const { site_id, ...query } = params;
      const response = await makeWordPressRequest('GET', "comments", query, { siteId: site_id });
      const comments: WPComment[] = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(comments, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error listing comments: ${errorMessage}` }],
        },
      };
    }
  },
  
  get_comment: async (params: GetCommentParams) => {
    try {
      const response = await makeWordPressRequest('GET', `comments/${params.id}`, undefined, { siteId: params.site_id });
      const comment: WPComment = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error getting comment: ${errorMessage}` }],
        },
      };
    }
  },
  
  create_comment: async (params: CreateCommentParams) => {
    try {
      const { site_id, ...body } = params;
      const response = await makeWordPressRequest('POST', "comments", body, { siteId: site_id });
      const comment: WPComment = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error creating comment: ${errorMessage}` }],
        },
      };
    }
  },
  
  update_comment: async (params: UpdateCommentParams) => {
    try {
      const { id, site_id, ...updateData } = params;
      const response = await makeWordPressRequest('POST', `comments/${id}`, updateData, { siteId: site_id });
      const comment: WPComment = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error updating comment: ${errorMessage}` }],
        },
      };
    }
  },
  
  delete_comment: async (params: DeleteCommentParams) => {
    try {
      const response = await makeWordPressRequest('DELETE', `comments/${params.id}`, { force: params.force }, { siteId: params.site_id });
      const comment: WPComment = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error deleting comment: ${errorMessage}` }],
        },
      };
    }
  }
};
