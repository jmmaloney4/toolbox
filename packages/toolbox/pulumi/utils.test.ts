import { generateProviderId, generateServiceAccountId } from "./utils";

describe("generateServiceAccountId", () => {
	describe("valid inputs", () => {
		it("should generate correct format with normal inputs", () => {
			const result = generateServiceAccountId("owner", "repo", "dev");
			expect(result).toBe("sa-owner-repo-dev");
			expect(result).toHaveLength(17); // sa-owner-repo-dev = 17 chars
		});

		it("should handle maximum stack name length", () => {
			const result = generateServiceAccountId("owner", "repo", "stage");
			expect(result).toBe("sa-owner-repo-stage");
			expect(result).toHaveLength(19); // sa-owner-repo-stage = 19 chars
		});

		it("should generate correct format with empty owner and repo", () => {
			const result = generateServiceAccountId("", "", "dev");
			expect(result).toBe("sa---dev");
			expect(result).toHaveLength(8); // sa---dev = 8 chars
		});

		it("should handle single character inputs", () => {
			const result = generateServiceAccountId("a", "b", "c");
			expect(result).toBe("sa-a-b-c");
			expect(result).toHaveLength(8); // sa-a-b-c = 8 chars
		});
	});

	describe("truncation behavior", () => {
		it("should truncate owner name to 15 characters", () => {
			const longOwner = "verylongownername123456789";
			const result = generateServiceAccountId(longOwner, "repo", "dev");
			expect(result).toBe("sa-verylongownerna-repo-dev");
			expect(result).toHaveLength(27); // sa-verylongownerna-repo-dev = 27 chars
		});

		it("should truncate repo name to 10 characters", () => {
			const longRepo = "verylongrepositoryname";
			const result = generateServiceAccountId("owner", longRepo, "dev");
			expect(result).toBe("sa-owner-verylongre-dev");
			expect(result).toHaveLength(23); // sa-owner-verylongre-dev = 23 chars
		});

		it("should truncate both owner and repo when both are long", () => {
			const longOwner = "verylongownername123456789";
			const longRepo = "verylongrepositoryname";
			const result = generateServiceAccountId(longOwner, longRepo, "prod");
			expect(result).toBe("sa-verylongownerna-verylongre-prod");
			expect(result).toHaveLength(34); // This is > 32, showing the issue
		});

		it("should handle exactly 15 char owner and 10 char repo", () => {
			const owner15 = "123456789012345"; // exactly 15 chars
			const repo10 = "1234567890"; // exactly 10 chars
			const result = generateServiceAccountId(owner15, repo10, "dev");
			expect(result).toBe("sa-123456789012345-1234567890-dev");
			expect(result).toHaveLength(33); // sa-123456789012345-1234567890-dev = 33 chars
		});
	});

	describe("stack name validation", () => {
		it("should throw error when stack name exceeds 5 characters", () => {
			expect(() => {
				generateServiceAccountId("owner", "repo", "toolong");
			}).toThrow(
				'Stack name "toolong" exceeds 5 character limit for account ID generation',
			);
		});

		it("should throw error when stack name is exactly 6 characters", () => {
			expect(() => {
				generateServiceAccountId("owner", "repo", "sixchr");
			}).toThrow(
				'Stack name "sixchr" exceeds 5 character limit for account ID generation',
			);
		});

		it("should accept stack name with exactly 5 characters", () => {
			const result = generateServiceAccountId("owner", "repo", "fivec");
			expect(result).toBe("sa-owner-repo-fivec");
		});

		it("should accept empty stack name", () => {
			const result = generateServiceAccountId("owner", "repo", "");
			expect(result).toBe("sa-owner-repo-");
		});
	});

	describe("special characters", () => {
		it("should handle special characters in owner name", () => {
			const result = generateServiceAccountId("owner-with-dash", "repo", "dev");
			expect(result).toBe("sa-owner-with-dash-repo-dev");
		});

		it("should handle special characters in repo name", () => {
			const result = generateServiceAccountId(
				"owner",
				"repo_with_underscore",
				"dev",
			);
			expect(result).toBe("sa-owner-repo_with_-dev"); // truncated to 10 chars
		});

		it("should handle numbers in all fields", () => {
			const result = generateServiceAccountId("owner123", "repo456", "789");
			expect(result).toBe("sa-owner123-repo456-789");
		});
	});
});

describe("generateProviderId", () => {
	describe("valid inputs", () => {
		it("should generate correct format with normal inputs", () => {
			const result = generateProviderId("owner", "repo", "dev");
			expect(result).toBe("provider-owner-repo-dev");
			expect(result).toHaveLength(23); // provider-owner-repo-dev = 23 chars
		});

		it("should handle maximum stack name length", () => {
			const result = generateProviderId("owner", "repo", "stage");
			expect(result).toBe("provider-owner-repo-stage");
			expect(result).toHaveLength(25); // provider-owner-repo-stage = 25 chars
		});

		it("should generate correct format with empty owner and repo", () => {
			const result = generateProviderId("", "", "dev");
			expect(result).toBe("provider---dev");
			expect(result).toHaveLength(14); // provider---dev = 14 chars
		});

		it("should handle single character inputs", () => {
			const result = generateProviderId("a", "b", "c");
			expect(result).toBe("provider-a-b-c");
			expect(result).toHaveLength(14); // provider-a-b-c = 14 chars
		});
	});

	describe("truncation behavior", () => {
		it("should truncate owner name to 12 characters", () => {
			const longOwner = "verylongownername";
			const result = generateProviderId(longOwner, "repo", "dev");
			expect(result).toBe("provider-verylongowne-repo-dev");
			expect(result).toHaveLength(30); // provider-verylongowne-repo-dev = 30 chars
		});

		it("should truncate repo name to 8 characters", () => {
			const longRepo = "verylongrepository";
			const result = generateProviderId("owner", longRepo, "dev");
			expect(result).toBe("provider-owner-verylong-dev");
			expect(result).toHaveLength(27); // provider-owner-verylong-dev = 27 chars
		});

		it("should truncate both owner and repo when both are long", () => {
			const longOwner = "verylongownername";
			const longRepo = "verylongrepository";
			const result = generateProviderId(longOwner, longRepo, "prod");
			expect(result).toBe("provider-verylongowne-verylong-prod");
			expect(result).toHaveLength(35); // This is > 32, showing potential issue
		});

		it("should handle exactly 12 char owner and 8 char repo", () => {
			const owner12 = "123456789012"; // exactly 12 chars
			const repo8 = "12345678"; // exactly 8 chars
			const result = generateProviderId(owner12, repo8, "dev");
			expect(result).toBe("provider-123456789012-12345678-dev");
			expect(result).toHaveLength(34); // provider-123456789012-12345678-dev = 34 chars
		});
	});

	describe("stack name validation", () => {
		it("should throw error when stack name exceeds 5 characters", () => {
			expect(() => {
				generateProviderId("owner", "repo", "toolong");
			}).toThrow(
				'Stack name "toolong" exceeds 5 character limit for provider ID generation',
			);
		});

		it("should throw error when stack name is exactly 6 characters", () => {
			expect(() => {
				generateProviderId("owner", "repo", "sixchr");
			}).toThrow(
				'Stack name "sixchr" exceeds 5 character limit for provider ID generation',
			);
		});

		it("should accept stack name with exactly 5 characters", () => {
			const result = generateProviderId("owner", "repo", "fivec");
			expect(result).toBe("provider-owner-repo-fivec");
		});

		it("should accept empty stack name", () => {
			const result = generateProviderId("owner", "repo", "");
			expect(result).toBe("provider-owner-repo-");
		});
	});

	describe("special characters", () => {
		it("should handle special characters in owner name", () => {
			const result = generateProviderId("owner-dash", "repo", "dev");
			expect(result).toBe("provider-owner-dash-repo-dev");
		});

		it("should handle special characters in repo name", () => {
			const result = generateProviderId("owner", "repo_underscore", "dev");
			expect(result).toBe("provider-owner-repo_und-dev"); // truncated to 8 chars
		});

		it("should handle numbers in all fields", () => {
			const result = generateProviderId("owner123", "repo456", "789");
			expect(result).toBe("provider-owner123-repo456-789");
		});
	});

	describe("32 character constraint verification", () => {
		it("should verify actual length constraint for provider ID", () => {
			// Test with max length inputs to see actual behavior
			const owner12 = "123456789012"; // 12 chars
			const repo8 = "12345678"; // 8 chars
			const stack5 = "12345"; // 5 chars
			const result = generateProviderId(owner12, repo8, stack5);
			expect(result).toBe("provider-123456789012-12345678-12345");
			expect(result).toHaveLength(36); // This reveals the actual length
		});
	});
});
